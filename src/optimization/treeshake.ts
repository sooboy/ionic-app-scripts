import { dirname, extname, join, relative } from 'path';
import { Logger } from '../logger/logger';
import * as Constants from '../util/constants';
import { changeExtension, convertFilePathToNgFactoryPath, escapeStringForRegex, getStringPropertyValue, toUnixPath } from '../util/helpers';
import { BuildContext, TreeShakeCalcResults } from '../util/interfaces';
import { findNodes, getTypescriptSourceFile, } from '../util/typescript-utils';

import {
  ImportDeclaration,
  ImportSpecifier,
  NamedImports,
  StringLiteral,
  SyntaxKind } from 'typescript';

export function calculateUnusedComponents(dependencyMap: Map<string, Set<string>>): TreeShakeCalcResults {
  return calculateUnusedComponentsImpl(dependencyMap, getIonicModuleFilePath());
}

export function calculateUnusedComponentsImpl(dependencyMap: Map<string, Set<string>>, importee: string): any {
  const filteredMap = filterMap(dependencyMap);
  processImportTree(filteredMap, importee);
  calculateUnusedIonicProviders(filteredMap);
  return generateResults(filteredMap);
}

function generateResults(dependencyMap: Map<string, Set<string>>) {
  const toPurgeMap = new Map<string, Set<string>>();
  const updatedMap = new Map<string, Set<string>>();
  dependencyMap.forEach((importeeSet: Set<string>, modulePath: string) => {
    if ((importeeSet && importeeSet.size > 0) || requiredModule(modulePath)) {
      Logger.debug(`[treeshake] generateResults: ${modulePath} is not purged`);
      updatedMap.set(modulePath, importeeSet);
    } else {
      Logger.debug(`[treeshake] generateResults: ${modulePath} is purged`);
      toPurgeMap.set(modulePath, importeeSet);
    }
  });
  return {
    updatedDependencyMap: updatedMap,
    purgedModules: toPurgeMap
  };
}

function requiredModule(modulePath: string) {
  const mainJsFile = changeExtension(getStringPropertyValue(Constants.ENV_APP_ENTRY_POINT), '.js');
  const mainTsFile = changeExtension(getStringPropertyValue(Constants.ENV_APP_ENTRY_POINT), '.ts');
  const appModule = changeExtension(getStringPropertyValue(Constants.ENV_APP_NG_MODULE_PATH), '.js');
  const appModuleNgFactory = getAppModuleNgFactoryPath();
  const moduleFile = getIonicModuleFilePath();
  return modulePath === mainJsFile || modulePath === mainTsFile || modulePath === appModule || modulePath === appModuleNgFactory || modulePath === moduleFile;
}

function filterMap(dependencyMap: Map<string, Set<string>>) {
  const filteredMap = new Map<string, Set<string>>();
  dependencyMap.forEach((importeeSet: Set<string>, modulePath: string) => {
    if (isIonicComponentOrAppSource(modulePath) || modulePath === getIonicModuleFilePath()) {
      importeeSet.delete(getStringPropertyValue(Constants.ENV_VAR_IONIC_ANGULAR_ENTRY_POINT));
      filteredMap.set(modulePath, importeeSet);
    }
  });
  return filteredMap;
}

function processImportTree(dependencyMap: Map<string, Set<string>>, importee: string) {
  const importees: string[] = [];
  dependencyMap.forEach((importeeSet: Set<string>, modulePath: string) => {
    if (importeeSet && importeeSet.has(importee)) {
      importeeSet.delete(importee);
      // if it importer by an `ngfactory` file, we probably aren't going to be able to purge it
      let ngFactoryImportee = false;
      const importeeList = Array.from(importeeSet);
      for (const entry of importeeList) {
        if (isNgFactory(entry)) {
          ngFactoryImportee = true;
          break;
        }
      }
      if (!ngFactoryImportee) {
        importees.push(modulePath);
      }
    }
  });
  importees.forEach(importee => processImportTree(dependencyMap, importee));
}

function calculateUnusedIonicProviders(dependencyMap: Map<string, Set<string>>) {
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: beginning to purge providers`);

  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to purge action sheet controller`);
  processIonicProviders(dependencyMap, getStringPropertyValue(Constants.ENV_ACTION_SHEET_CONTROLLER_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to purge alert controller`);
  processIonicProviders(dependencyMap, getStringPropertyValue(Constants.ENV_ALERT_CONTROLLER_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to loading controller`);
  processIonicProviders(dependencyMap, getStringPropertyValue(Constants.ENV_LOADING_CONTROLLER_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to modal controller`);
  processIonicProviders(dependencyMap, getStringPropertyValue(Constants.ENV_MODAL_CONTROLLER_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to picker controller`);
  processIonicProviders(dependencyMap, getStringPropertyValue(Constants.ENV_PICKER_CONTROLLER_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to popover controller`);
  processIonicProviders(dependencyMap, getStringPropertyValue(Constants.ENV_POPOVER_CONTROLLER_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to toast controller`);
  processIonicProviders(dependencyMap, getStringPropertyValue(Constants.ENV_TOAST_CONTROLLER_PATH));

  // check if the controllers were deleted, if so, purge the component too
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to action sheet component`);
  processIonicProviderComponents(dependencyMap, getStringPropertyValue(Constants.ENV_ACTION_SHEET_CONTROLLER_PATH), getStringPropertyValue(Constants.ENV_ACTION_SHEET_COMPONENT_FACTORY_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to alert component`);
  processIonicProviderComponents(dependencyMap, getStringPropertyValue(Constants.ENV_ALERT_CONTROLLER_PATH), getStringPropertyValue(Constants.ENV_ALERT_COMPONENT_FACTORY_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to loading component`);
  processIonicProviderComponents(dependencyMap, getStringPropertyValue(Constants.ENV_LOADING_CONTROLLER_PATH), getStringPropertyValue(Constants.ENV_LOADING_COMPONENT_FACTORY_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to modal component`);
  processIonicProviderComponents(dependencyMap, getStringPropertyValue(Constants.ENV_MODAL_CONTROLLER_PATH), getStringPropertyValue(Constants.ENV_MODAL_COMPONENT_FACTORY_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to picker component`);
  processIonicProviderComponents(dependencyMap, getStringPropertyValue(Constants.ENV_PICKER_CONTROLLER_PATH), getStringPropertyValue(Constants.ENV_PICKER_COMPONENT_FACTORY_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to popover component`);
  processIonicProviderComponents(dependencyMap, getStringPropertyValue(Constants.ENV_POPOVER_CONTROLLER_PATH), getStringPropertyValue(Constants.ENV_POPOVER_COMPONENT_FACTORY_PATH));
  Logger.debug(`[treeshake] calculateUnusedIonicProviders: attempting to toast component`);
  processIonicProviderComponents(dependencyMap, getStringPropertyValue(Constants.ENV_TOAST_CONTROLLER_PATH), getStringPropertyValue(Constants.ENV_TOAST_COMPONENT_FACTORY_PATH));

  // in this case, it's actually an entry component, not a provider
  processIonicProviders(dependencyMap, getStringPropertyValue(Constants.ENV_SELECT_POPOVER_COMPONENT_FACTORY_PATH));

}

function processIonicProviderComponents(dependencyMap: Map<string, Set<string>>, providerPath: string, componentPath: string) {
  const importeeSet = dependencyMap.get(providerPath);
  if (importeeSet && importeeSet.size === 0) {
    processIonicProviders(dependencyMap, componentPath);
  }
}

export function getAppModuleNgFactoryPath() {
  const appNgModulePath = getStringPropertyValue(Constants.ENV_APP_NG_MODULE_PATH);
  const jsVersion = changeExtension(appNgModulePath, '.js');
  return convertFilePathToNgFactoryPath(jsVersion);
}

function processIonicProviders(dependencyMap: Map<string, Set<string>>, providerPath: string) {
  const importeeSet = dependencyMap.get(providerPath);
  const appModuleNgFactoryPath = getAppModuleNgFactoryPath();

  // we can only purge an ionic provider if it is imported from one module, which is the AppModuleNgFactory
  if (importeeSet && importeeSet.has(appModuleNgFactoryPath)) {
    Logger.debug(`[treeshake] processIonicProviders: Purging ${providerPath}`);
    importeeSet.delete(appModuleNgFactoryPath);
    // loop over the dependency map and remove this provider from importee sets
    processImportTreeForProviders(dependencyMap, providerPath);
  }
}

function processImportTreeForProviders(dependencyMap: Map<string, Set<string>>, importee: string) {
  const importees: string[] = [];
  dependencyMap.forEach((importeeSet: Set<string>, modulePath: string) => {
    if (importeeSet.has(importee)) {
      importeeSet.delete(importee);
      importees.push(modulePath);
    }
  });
  importees.forEach(importee => processImportTreeForProviders(dependencyMap, importee));
}

export function isIonicComponentOrAppSource(modulePath: string) {
  // for now, just use a simple filter of if a file is in ionic-angular/components
  const ionicAngularComponentDir = join(getStringPropertyValue(Constants.ENV_VAR_IONIC_ANGULAR_DIR), 'components');
  const srcDir = getStringPropertyValue(Constants.ENV_VAR_SRC_DIR);
  return modulePath.indexOf(ionicAngularComponentDir) >= 0 || modulePath.indexOf(srcDir) >= 0;
}

export function isNgFactory(modulePath: string) {
  return modulePath.indexOf('.ngfactory.') >= 0;
}

export function purgeUnusedImportsAndExportsFromModuleFile(indexFilePath: string, indexFileContent: string, modulePathsToPurge: string[] ) {
  Logger.debug(`[treeshake] purgeUnusedImportsFromIndex: Starting to purge import/exports ... `);
  for (const modulePath of modulePathsToPurge) {
    // I cannot get the './' prefix to show up when using path api
    Logger.debug(`[treeshake] purgeUnusedImportsFromIndex: Removing ${modulePath} from ${indexFilePath}`);

    const extensionless = changeExtension(modulePath, '');
    const relativeImportPath = './' + relative(dirname(indexFilePath), extensionless);
    const importPath = toUnixPath(relativeImportPath);
    Logger.debug(`[treeshake] purgeUnusedImportsFromIndex: Removing imports with path ${importPath}`);
    const importRegex = generateImportRegex(importPath);
    // replace the import if it's found
    let results: RegExpExecArray = null;
    while ((results = importRegex.exec(indexFileContent)) && results.length) {
      indexFileContent = indexFileContent.replace(importRegex, `/*${results[0]}*/`);
    }

    results = null;
    const exportRegex = generateExportRegex(importPath);
    Logger.debug(`[treeshake] purgeUnusedImportsFromIndex: Removing exports with path ${importPath}`);
    while ((results = exportRegex.exec(indexFileContent)) && results.length) {
      indexFileContent = indexFileContent.replace(exportRegex, `/*${results[0]}*/`);
    }
  }

  Logger.debug(`[treeshake] purgeUnusedImportsFromIndex: Starting to purge import/exports ... DONE`);
  return indexFileContent;
}

function generateImportRegex(relativeImportPath: string) {
  const cleansedString = escapeStringForRegex(relativeImportPath);
  return new RegExp(`^import.*?{(.+)}.*?from.*?['"\`]${cleansedString}['"\`];`, 'gm');
}

function generateExportRegex(relativeExportPath: string) {
  const cleansedString = escapeStringForRegex(relativeExportPath);
  return new RegExp(`^export.*?{(.+)}.*?from.*?'${cleansedString}';`, 'gm');
}

export function purgeComponentNgFactoryImportAndUsage(appModuleNgFactoryPath: string, appModuleNgFactoryContent: string, componentFactoryPath: string) {
  Logger.debug(`[treeshake] purgeComponentNgFactoryImportAndUsage: Starting to purge component ngFactory import/export ...`);
  const extensionlessComponentFactoryPath = changeExtension(componentFactoryPath, '');
  const relativeImportPath = relative(dirname(appModuleNgFactoryPath), extensionlessComponentFactoryPath);
  const importPath = toUnixPath(relativeImportPath);
  Logger.debug(`[treeshake] purgeComponentNgFactoryImportAndUsage: Purging imports from ${importPath}`);
  const importRegex = generateWildCardImportRegex(importPath);
  const results = importRegex.exec(appModuleNgFactoryContent);
  if (results && results.length >= 2) {
    appModuleNgFactoryContent = appModuleNgFactoryContent.replace(importRegex, `/*${results[0]}*/`);
    const namedImport = results[1].trim();
    Logger.debug(`[treeshake] purgeComponentNgFactoryImportAndUsage: Purging code using named import ${namedImport}`);
    const purgeFromConstructor = generateRemoveComponentFromConstructorRegex(namedImport);
    const purgeFromConstructorResults = purgeFromConstructor.exec(appModuleNgFactoryContent);
    if (purgeFromConstructorResults && purgeFromConstructorResults.length) {
      appModuleNgFactoryContent = appModuleNgFactoryContent.replace(purgeFromConstructor, `/*${purgeFromConstructorResults[0]}*/`);
    }
  }
  Logger.debug(`[treeshake] purgeComponentNgFactoryImportAndUsage: Starting to purge component ngFactory import/export ... DONE`);
  return appModuleNgFactoryContent;
}

export function purgeProviderControllerImportAndUsage(appModuleNgFactoryPath: string, appModuleNgFactoryContent: string, providerPath: string) {
  Logger.debug(`[treeshake] purgeProviderControllerImportAndUsage: Starting to purge provider controller and usage ...`);
  const extensionlessComponentFactoryPath = changeExtension(providerPath, '');
  const relativeImportPath = relative(dirname(getStringPropertyValue(Constants.ENV_VAR_IONIC_ANGULAR_DIR)), extensionlessComponentFactoryPath);
  const importPath = toUnixPath(relativeImportPath);
  Logger.debug(`[treeshake] purgeProviderControllerImportAndUsage: Looking for imports from ${importPath}`);
  const importRegex = generateWildCardImportRegex(importPath);
  const results = importRegex.exec(appModuleNgFactoryContent);
  if (results && results.length >= 2) {
    const namedImport = results[1].trim();

    // purge the getter
    const purgeGetterRegEx = generateRemoveGetterFromImportRegex(namedImport);
    const purgeGetterResults = purgeGetterRegEx.exec(appModuleNgFactoryContent);

    const purgeIfRegEx = generateRemoveIfStatementRegex(namedImport);
    const purgeIfResults = purgeIfRegEx.exec(appModuleNgFactoryContent);

    if (purgeGetterResults && purgeIfResults) {

      Logger.debug(`[treeshake] purgeProviderControllerImportAndUsage: Purging imports ${namedImport}`);
      appModuleNgFactoryContent = appModuleNgFactoryContent.replace(importRegex, `/*${results[0]}*/`);

      Logger.debug(`[treeshake] purgeProviderControllerImportAndUsage: Purging getter logic using ${namedImport}`);
      const getterContentToReplace = purgeGetterResults[0];
      const newGetterContent = `/*${getterContentToReplace}*/`;
      appModuleNgFactoryContent = appModuleNgFactoryContent.replace(getterContentToReplace, newGetterContent);

      Logger.debug(`[treeshake] purgeProviderControllerImportAndUsage: Purging additional logic using ${namedImport}`);
      const purgeIfContentToReplace = purgeIfResults[0];
      const newPurgeIfContent = `/*${purgeIfContentToReplace}*/`;
      appModuleNgFactoryContent = appModuleNgFactoryContent.replace(purgeIfContentToReplace, newPurgeIfContent);
    }
  }

  Logger.debug(`[treeshake] purgeProviderControllerImportAndUsage: Starting to purge provider controller and usage ... DONE`);
  return appModuleNgFactoryContent;
}

export function purgeProviderClassNameFromIonicModuleForRoot(indexFileContent: string, providerClassName: string) {
  Logger.debug(`[treeshake] purgeProviderClassNameFromIonicModuleForRoot: Purging reference in the ionicModule forRoot method ...`);
  const regex = generateIonicModulePurgeProviderRegex(providerClassName);
  const results = regex.exec(indexFileContent);
  if (results && results.length) {
    indexFileContent = indexFileContent.replace(regex, `/*${results[0]}*/`);
  }
  Logger.debug(`[treeshake] purgeProviderClassNameFromIonicModuleForRoot: Purging reference in the ionicModule forRoot method ... DONE`);
  return indexFileContent;
}

export function generateWildCardImportRegex(relativeImportPath: string) {
  const cleansedString = escapeStringForRegex(relativeImportPath);
  return new RegExp(`import.*?as(.*?)from '${cleansedString}';`);
}

export function generateRemoveComponentFromConstructorRegex(namedImport: string) {
  return new RegExp(`${namedImport}\..*?,`);
}

export function generateRemoveGetterFromImportRegex(namedImport: string) {
  const regexString = `(get _.*?_\\d*\\(\\) {[\\s\\S][^}]*?${namedImport}[\\s\\S]*?}[\\s\\S]*?})`;
  return new RegExp(regexString);
}

export function generateRemoveIfStatementRegex(namedImport: string) {
  return new RegExp(`if \\(\\(token === ${namedImport}.([\\S]*?)\\)\\) {([\\S\\s]*?)}`, `gm`);
}

export function generateIonicModulePurgeProviderRegex(className: string) {
  return new RegExp(`${className},`, `gm`);
}

export function getIonicModuleFilePath() {
  const entryPoint = getStringPropertyValue(Constants.ENV_VAR_IONIC_ANGULAR_ENTRY_POINT);
  return join(dirname(entryPoint), 'module.js');
}

// okay, so real talk
// the ng4 compiler changed how some of this stuff works.
// basically, due to imports not-really-being-used in AoT mode WRT pages/providers,
// we don't have a good way of detecting whether a provider is actually used in an app
// since they're in the ng-module ng-factories regardless if they're used or not. If that sounds
// confusing and weird - it's because it is.
// the simple answer is this method analyzes a developers srcDir for TS files
// and if they import a provider, we are manually inserting those files into the "dependency map"
// so that we have an accurate representation of what's user providers
export function checkIfProviderIsUsedInSrc(context: BuildContext, dependencyMap: Map<string, Set<string>>) {
  const srcFiles = context.fileCache.getAll().filter(file => extname(file.path) === '.ts'
                                                    && file.path.startsWith(context.srcDir)
                                                    && !file.path.endsWith('.d.ts')
                                                    && !file.path.endsWith('.ngfactory.ts')
                                                    && !file.path.endsWith(getStringPropertyValue(Constants.ENV_NG_MODULE_FILE_NAME_SUFFIX)));
  srcFiles.forEach(srcFile => {
    const sourceFile = getTypescriptSourceFile(srcFile.path, srcFile.content);
    const imports = findNodes(sourceFile, sourceFile, SyntaxKind.ImportDeclaration) as ImportDeclaration[];
    imports.forEach((importStatement: ImportDeclaration) => {
      if ((importStatement.moduleSpecifier as StringLiteral).text === 'ionic-angular'
        && importStatement.importClause.namedBindings
        && (importStatement.importClause.namedBindings as NamedImports).elements) {
        (importStatement.importClause.namedBindings as NamedImports).elements.forEach((importSpecifier: ImportSpecifier) => {
          if (importSpecifier.name.text === getStringPropertyValue(Constants.ENV_ACTION_SHEET_CONTROLLER_CLASSNAME)) {
            const actionSheetControllerPath = getStringPropertyValue(Constants.ENV_ACTION_SHEET_CONTROLLER_PATH);
            const importeeSet = dependencyMap.get(actionSheetControllerPath);
            importeeSet.add(srcFile.path);
            dependencyMap.set(actionSheetControllerPath, importeeSet);
          } else if (importSpecifier.name.text === getStringPropertyValue(Constants.ENV_ALERT_CONTROLLER_CLASSNAME)) {
            const alertControllerPath = getStringPropertyValue(Constants.ENV_ALERT_CONTROLLER_PATH);
            const importeeSet = dependencyMap.get(alertControllerPath);
            importeeSet.add(srcFile.path);
            dependencyMap.set(alertControllerPath, importeeSet);
          } else if (importSpecifier.name.text === getStringPropertyValue(Constants.ENV_LOADING_CONTROLLER_CLASSNAME)) {
            const loadingControllerPath = getStringPropertyValue(Constants.ENV_LOADING_CONTROLLER_PATH);
            const importeeSet = dependencyMap.get(loadingControllerPath);
            importeeSet.add(srcFile.path);
            dependencyMap.set(loadingControllerPath, importeeSet);
          } else if (importSpecifier.name.text === getStringPropertyValue(Constants.ENV_MODAL_CONTROLLER_CLASSNAME)) {
            const modalControllerPath = getStringPropertyValue(Constants.ENV_MODAL_CONTROLLER_PATH);
            const importeeSet = dependencyMap.get(modalControllerPath);
            importeeSet.add(srcFile.path);
            dependencyMap.set(modalControllerPath, importeeSet);
          } else if (importSpecifier.name.text === getStringPropertyValue(Constants.ENV_PICKER_CONTROLLER_CLASSNAME)) {
            const pickerControllerPath = getStringPropertyValue(Constants.ENV_PICKER_CONTROLLER_PATH);
            const importeeSet = dependencyMap.get(pickerControllerPath);
            importeeSet.add(srcFile.path);
            dependencyMap.set(pickerControllerPath, importeeSet);
          } else if (importSpecifier.name.text === getStringPropertyValue(Constants.ENV_POPOVER_CONTROLLER_CLASSNAME)) {
            const popoverControllerPath = getStringPropertyValue(Constants.ENV_POPOVER_CONTROLLER_PATH);
            const importeeSet = dependencyMap.get(popoverControllerPath);
            importeeSet.add(srcFile.path);
            dependencyMap.set(popoverControllerPath, importeeSet);
          } else if (importSpecifier.name.text === getStringPropertyValue(Constants.ENV_TOAST_CONTROLLER_CLASSNAME)) {
            const toastControllerPath = getStringPropertyValue(Constants.ENV_TOAST_CONTROLLER_PATH);
            const importeeSet = dependencyMap.get(toastControllerPath);
            importeeSet.add(srcFile.path);
            dependencyMap.set(toastControllerPath, importeeSet);
          }
        });
      }
    });
  });
  return dependencyMap;
}
