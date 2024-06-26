import {
	getScriptKindDecorator,
	getScriptSnapshotDecorator,
	resolveModuleNameLiteralsDecorator,
} from './decorators'
import { getDefinitionServiceDecorator } from './decorators/getDefinitionAtPosition'
import { createLogger, decorateHost } from './factories'
import { createFileAccessObject } from './factories/fileAccessObject'
import { isSolidity } from './utils'
import { loadConfig } from '@evmts/config'
import typescript from 'typescript/lib/tsserverlibrary'

/**
 * [Typescript plugin factory](https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin)
 * @example
 * ```json
 * {
 *   "plugins": [{ "name": "evmts-ts-plugin"}]
 * }
 * @see https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin#decorator-creation
 */
export const tsPlugin: typescript.server.PluginModuleFactory = (modules) => {
	return {
		create: (createInfo) => {
			const logger = createLogger(createInfo)
			const config = loadConfig(
				createInfo.project.getCurrentDirectory(),
				logger,
			)
			const fao = createFileAccessObject(createInfo.languageServiceHost)
			const service = getDefinitionServiceDecorator(
				modules.typescript.createLanguageService(
					decorateHost(
						getScriptKindDecorator,
						resolveModuleNameLiteralsDecorator,
						getScriptSnapshotDecorator,
					)(createInfo, modules.typescript, logger, config, fao),
				),
				config,
				logger,
				modules.typescript,
				fao,
			)

			return service
		},
		getExternalFiles: (project) => {
			return project.getFileNames().filter(isSolidity)
		},
	}
}
