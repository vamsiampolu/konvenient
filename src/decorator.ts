import {SchemaObj, ValidateOptions} from 'convict'
import cloneDeepWith from 'lodash.clonedeepwith'
import {libraryConfiguration} from './configuration'
import {
  ConfigurableSchema,
  ConfigurationSchema,
  ConfigurableSchemaWithDefault,
  ConfigurationSchemaWithDefaults,
  NestedConfigurationSchema,
  nestedPrototype,
  nestedSchema,
} from './schema'
import {injectable} from './peer/inversify'
import {resolveValues, resolveNestedPrototypes, resolveEnv} from './resolution'

export const optionsKey = Symbol('options')
export const configurationSchema = Symbol('configurationSchema')
export const loadedValues = Symbol('loadedValues')

export interface ConfigurationOptions {
  pathPrefix?: string
  envPrefix?: string
}

const defaultConfigurationOptions: ConfigurationOptions = {}

export interface FinalizedConfigurationOptions
  extends Required<ConfigurationOptions> {
  name: string
}

export interface DecoratedPrototype {
  [optionsKey]: FinalizedConfigurationOptions
  [configurationSchema]: ConfigurationSchema
}

export interface DecoratedConstructor {
  prototype: DecoratedPrototype
  new (): any
}

export type LoadedTarget = {
  [loadedValues]: Record<string, unknown>
}

/**
 * Marks a class as a configuration class. Configuration classes
 * shall adhere to the following requirements:
 *
 *   * have a default or no argument constructor.
 *
 * @returns The actual decorator applied to the class.
 */
export function Configuration(
  options: Partial<ConfigurationOptions> = defaultConfigurationOptions,
) {
  return function (constructor: new () => any) {
    const actualOptions: FinalizedConfigurationOptions = {
      ...defaultConfigurationOptions,
      pathPrefix: libraryConfiguration.fileKeyDerivationStrategy(
        constructor.name,
      ),
      envPrefix: libraryConfiguration.envKeyDerivationStrategy.deriveKey(
        constructor.name,
      ),
      ...options,
      name: constructor.name,
    }

    const wrappedConstructor = (
      injectable ? (injectable()(constructor) as new () => any) : constructor
    ) as DecoratedConstructor

    wrappedConstructor.prototype[optionsKey] = actualOptions

    const parent: unknown = Object.getPrototypeOf(wrappedConstructor.prototype)
    const parentSchema = extractSchemaFromPrototype(parent)
    const currentSchema = extractSchemaFromPrototype(
      wrappedConstructor.prototype,
    )
    for (const propertyKey of Object.keys(parentSchema)) {
      currentSchema[propertyKey] = cloneDeepWith(parentSchema[propertyKey])

      Object.defineProperty(wrappedConstructor.prototype, propertyKey, {
        enumerable: true,
        get() {
          return retrieveValue(wrappedConstructor.prototype, propertyKey)
        },
        set(value) {
          if (
            !Object.prototype.hasOwnProperty.call(
              currentSchema[propertyKey],
              'default',
            )
          ) {
            ;(
              currentSchema[propertyKey] as ConfigurableSchemaWithDefault
            ).default = value
          }
        },
      })
    }

    // eslint-disable-next-line new-cap, no-new
    new wrappedConstructor()
  }
}

/**
 * Marks a field on a configuration class configurable (loadable with convict). Configurable
 * fields shall adhere to the following requirements:
 *
 *   * have a default value.
 *
 * @param propertySchema The convict schema used to load, validate and transform the configuration value.
 * @returns The actual decorator applied to the field.
 */
export function Configurable<T = any>(
  propertySchema: ConfigurableSchema<T> = {},
) {
  return function (target: any, propertyKey: string) {
    const schema = extractSchemaFromPrototype(target)

    schema[propertyKey] = propertySchema

    Object.defineProperty(target, propertyKey, {
      enumerable: true,
      get() {
        return retrieveValue(target, propertyKey)
      },
      set(value) {
        if (
          !Object.prototype.hasOwnProperty.call(schema[propertyKey], 'default')
        ) {
          ;(schema[propertyKey] as ConfigurableSchemaWithDefault).default =
            value
        }
      },
    })
  }
}

/**
 * Marks a field on a configuration class as nested configuration. Nested configuration
 * fields shall adhere to the following requirements:
 *
 *   * have a configuration class as their default value.
 *
 * @returns The actual decorator applied to the field.
 */
export function Nested() {
  return function (target: any, propertyKey: string) {
    const schema = extractSchemaFromPrototype(target)

    Object.defineProperty(target, propertyKey, {
      enumerable: true,
      get() {
        return retrieveValue(target, propertyKey)
      },
      set(value) {
        if (!Object.prototype.hasOwnProperty.call(schema, propertyKey)) {
          schema[propertyKey] = nestedSchemaOf(value)
        }
      },
    })
  }
}

export function nestedSchemaOf(target: any) {
  const clonedSchema = cloneDeepWith(
    extractSchemaFromPrototype(Object.getPrototypeOf(target)),
    (value) => {
      if (typeof value === 'function') {
        return value as unknown
      }

      return undefined
    },
  ) as ConfigurationSchema

  return Object.assign(clonedSchema, {
    [nestedSchema]: true,
    [nestedPrototype]: Object.getPrototypeOf(target) as unknown,
  }) as NestedConfigurationSchema
}

function retrieveValue(target: any, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(target, loadedValues)) {
    loadConfigurationOf(target)
  }

  return (target as LoadedTarget)[loadedValues][key]
}

export function isDecoratedPrototype(
  target: any,
): target is DecoratedPrototype {
  return Object.prototype.hasOwnProperty.call(target, configurationSchema)
}

export function extractSchemaFromPrototype(target: any): ConfigurationSchema {
  if (isDecoratedPrototype(target)) {
    return target[configurationSchema]
  }

  const schema = Object.create(null) as ConfigurationSchema

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  target[configurationSchema] = schema

  return schema
}

function loadConfigurationOf(target: any) {
  const schema = extractSchemaFromPrototype(
    target,
  ) as ConfigurationSchemaWithDefaults

  resolveEnv(schema, (target as DecoratedPrototype)[optionsKey].envPrefix)

  libraryConfiguration.onSchemaAssembledHook(
    schema,
    (target as DecoratedPrototype)[optionsKey].name,
  )

  const convictSchema = Object.create(null) as SchemaObj

  for (const key of Object.keys(schema)) {
    convictSchema[key] = schema[key]
  }

  let config
  if ((target as DecoratedPrototype)[optionsKey].pathPrefix === '') {
    config = libraryConfiguration.convict(convictSchema)
  } else {
    config = libraryConfiguration.convict({
      [(target as DecoratedPrototype)[optionsKey].pathPrefix]: convictSchema,
    })
  }

  config.loadFile(libraryConfiguration.sources)

  // The type definition of convict does not list the output property,
  // thus, we had to get creative.
  config.validate({
    allowed: 'warn',
    output() {
      // No-op.
    },
  } as ValidateOptions)

  libraryConfiguration.onConfigLoadedHook(
    schema,
    config,
    (target as DecoratedPrototype)[optionsKey].name,
  )

  const values = Object.create(null) as Record<string, unknown>

  resolveValues(
    values,
    schema,
    config,
    (target as DecoratedPrototype)[optionsKey].pathPrefix,
  )

  resolveNestedPrototypes(values, schema)
  ;(target as LoadedTarget)[loadedValues] = values
}
