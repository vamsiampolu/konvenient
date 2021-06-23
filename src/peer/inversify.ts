import {ClassDecoratorFactory} from '../util'

type Inversify = {
	injectable: ClassDecoratorFactory
}

export const injectable: ClassDecoratorFactory | null = (function () {
	try {
		const inversify = require('inversify') as Inversify

		return inversify.injectable
	} catch {
		return null
	}
})()
