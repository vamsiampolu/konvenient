module.exports = {
	envs: ['node', 'jest'],
	semicolon: false,
	prettier: true,
	rules: {
		'import/no-unassigned-import': 'off',
		'unicorn/prefer-module': 'off',
		'unicorn/prefer-node-protocol': 'off',
		'@typescript-eslint/no-require-imports': 'off',
		'@typescript-eslint/no-var-requires': 'off'
	},
	ignores: ['_templates']
}
