/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const ModelManager = require('./modelmanager');
const Serializer = require('./serializer');
const Factory = require('./factory');
const ModelUtil = require('./modelutil');

// Types needed for TypeScript generation.
/* eslint-disable no-unused-vars */
/* istanbul ignore next */
if (global === undefined) {
    const ModelFile = require('./introspect/modelfile');
}
/* eslint-enable no-unused-vars */


const DCS_MODEL = `concerto version "^3.0.0"
namespace org.accordproject.decoratorcommands@0.3.0

import concerto.metamodel@1.0.0.Decorator

/**
 * A reference to an existing named & versioned DecoratorCommandSet
 */
concept DecoratorCommandSetReference {
    o String name
    o String version
}

/**
 * Whether to upsert or append the decorator
 */
enum CommandType {
    o UPSERT
    o APPEND
}

/**
 * Which models elements to add the decorator to. Any null
 * elements are 'wildcards'. 
 */
concept CommandTarget {
    o String namespace optional
    o String declaration optional
    o String property optional
    o String[] properties optional // property and properties are mutually exclusive
    o String type optional 
}

/**
 * Applies a decorator to a given target
 */
concept Command {
    o CommandTarget target
    o Decorator decorator
    o CommandType type
}

/**
 * A named and versioned set of commands. Includes are supported for modularity/reuse.
 */
concept DecoratorCommandSet {
    o String name
    o String version
    o DecoratorCommandSetReference[] includes optional // not yet supported
    o Command[] commands
}
`;

/**
 * Intersection of two string arrays
 * @param {string[]} a the first array
 * @param {string[]} b the second array
 * @returns {string[]} returns the intersection of a and b (i.e. an
 * array of the elements they have in common)
 */
function intersect(a, b) {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    return Array.from(intersection);
}

/**
 * Returns true if the unversioned namespace for a model
 * file is equal to a target
 * @param {ModelFile} modelFile the model file to test
 * @param {string} unversionedNamespace the unversioned namespace to test against
 * @returns {boolean} true is the unversioned namespace for the
 * model file equals unversionedNamespace
 */
function isUnversionedNamespaceEqual(modelFile, unversionedNamespace) {
    const { name } = ModelUtil.parseNamespace(modelFile.getNamespace());
    return name === unversionedNamespace;
}

/**
 * Utility functions to work with
 * [DecoratorCommandSet](https://models.accordproject.org/concerto/decorators.cto)
 * @memberof module:concerto-core
 */
class DecoratorManager {

    /**
     * Structural validation of the decoratorCommandSet against the
     * Decorator Command Set model. Note that this only checks the
     * structural integrity of the command set, it cannot check
     * whether the commands are valid with respect to a model manager.
     * Use the options.validateCommands option with decorateModels
     * method to perform semantic validation.
     * @param {*} decoratorCommandSet the DecoratorCommandSet object
     * @param {ModelFile[]} [modelFiles] an optional array of model
     * files that are added to the validation model manager returned
     * @returns {ModelManager} the model manager created for validation
     * @throws {Error} throws an error if the decoratorCommandSet is invalid
     */
    static validate(decoratorCommandSet, modelFiles) {
        const validationModelManager = new ModelManager({
            strict: true,
            metamodelValidation: true,
            addMetamodel: true,
        });
        if(modelFiles) {
            validationModelManager.addModelFiles(modelFiles);
        }
        validationModelManager.addCTOModel(
            DCS_MODEL,
            'decoratorcommands@0.3.0.cto'
        );
        const factory = new Factory(validationModelManager);
        const serializer = new Serializer(factory, validationModelManager);
        serializer.fromJSON(decoratorCommandSet);
        return validationModelManager;
    }

    /**
     * Applies all the decorator commands from the DecoratorCommandSet
     * to the ModelManager.
     * @param {ModelManager} modelManager the input model manager
     * @param {*} decoratorCommandSet the DecoratorCommandSet object
     * @param {object} [options] - decorator models options
     * @param {boolean} [options.validate] - validate that decorator command set is valid
     * with respect to to decorator command set model
     * @param {boolean} [options.validateCommands] - validate the decorator command set targets. Note that
     * the validate option must also be true
     * @returns {ModelManager} a new model manager with the decorations applied
     */
    static decorateModels(modelManager, decoratorCommandSet, options) {
        if (options?.validate) {
            const validationModelManager = DecoratorManager.validate(decoratorCommandSet, modelManager.getModelFiles());
            if (options?.validateCommands) {
                decoratorCommandSet.commands.forEach((command) => {
                    DecoratorManager.validateCommand(
                        validationModelManager,
                        command
                    );
                });
            }
        }
        const ast = modelManager.getAst(true);
        const decoratedAst = JSON.parse(JSON.stringify(ast));
        decoratedAst.models.forEach((model) => {
            model.declarations.forEach((decl) => {
                decoratorCommandSet.commands.forEach((command) => {
                    this.executeCommand(model.namespace, decl, command);
                });
            });
        });
        const newModelManager = new ModelManager();
        newModelManager.fromAst(decoratedAst);
        return newModelManager;
    }
    /**
    * Adds a key-value pair to a dictionary (object) if the key exists,
    * or creates a new key with the provided value.
    *
    * @param {Object} dictionary - The dictionary (object) to which to add the key-value pair.
    * @param {string} key - The key to add or update.
    * @param {any} value - The value to add or update.
    * @param {string} declaration - The target decl.
    * @param {string} property The target property.
    */
    static addToDict(dictionary, key, value, declaration,property) {
        const val = {
            declaration,
            property,
            dcs: JSON.stringify(value),
        };
        if (dictionary[key]) {
            dictionary[key].push(val);
        } else {
            dictionary[key] = [val];
        }
    }

    /**
     * Extracts all the decorator commands from all the models in modelManager
     * @param {ModelManager} modelManager the input model manager
     * @param {object} [options] - decorator models options
     * @returns {Object} a new model manager with the decorations removed and a list of extracted decorator jsons
     */
    static extractDecorators(modelManager,options) {
        const ast = modelManager.getAst(true);
        const unDecoratedAst = JSON.parse(JSON.stringify(ast));
        let decoractorDict={};
        unDecoratedAst.models.forEach((model) => {
            if (model.decorators && model.decorators.length>0){
                this.processDecorators(model.namespace, model.decorators, decoractorDict, options.removeDecoratorsFromModel,'','');
            }
            model.declarations.forEach((decl) => {
                this.extractDecoratorFromModel(model.namespace,decl,decoractorDict,options.removeDecoratorsFromModel);
            });
        });
        const newModelManager = new ModelManager();
        newModelManager.fromAst(unDecoratedAst);
        let dcms=this.parseDecorators(decoractorDict);
        let vocab = this.parseVocabs(decoractorDict,options.locale);
        return {
            modelManager:newModelManager,
            decoratorCommandSet:dcms,
            vocabularies:vocab,
            decoractorDict
        };
    }

    /**
     * Parses the dict data into an array of decorator jsons
     * @param {Object} decoratorDict the input dict
     * @returns {Array<Object>} the parsed decorator command set array
     */
    static parseDecorators(decoratorDict){
        let data = [];
        Object.keys(decoratorDict).forEach((namespace)=>{
            let nameOfDcs=namespace.split('@')[0];
            let versionOfDcs=namespace.includes('@')?namespace.split('@')[1]:'1.0.0';
            let dcsObjects=[];
            let jsonData=decoratorDict[namespace];
            jsonData.forEach((obj)=>{
                let decos=JSON.parse(obj.dcs);
                let target={
                    '$class': 'org.accordproject.decoratorcommands.CommandTarget',
                    'namespace':namespace
                };
                if (obj.declaration && obj.declaration!==''){
                    target.declaration=obj.declaration;
                }
                if (obj.property && obj.property!==''){
                    target.property=obj.property;
                }
                decos.forEach((dcs)=>{
                    if (dcs.name!=='Term' && dcs.name!=='Term_description'){
                        let decotatorObj={
                            '$class': 'concerto.metamodel@1.0.0.Decorator',
                            'name': dcs.name,
                        };
                        if (dcs.arguments){
                            let args=dcs.arguments.map((arg)=>{
                                return {
                                    '$class':arg.$class,
                                    'value':arg.value
                                };
                            });
                            decotatorObj.arguments=args;
                        }
                        let dcsObject = {
                            '$class': 'org.accordproject.decoratorcommands.Command',
                            'type': 'UPSERT',
                            'target': target,
                            'decorator': decotatorObj,
                        };
                        dcsObjects.push(dcsObject);
                    }
                });
            });
            let dcmsForNamespace={
                '$class': 'org.accordproject.decoratorcommands.DecoratorCommandSet',
                'name': nameOfDcs,
                'version': versionOfDcs,
                'commands': dcsObjects
            };
            data.push(dcmsForNamespace);
        });
        return data;
    }
    /**
     * Parses the dict data into an array of decorator jsons
     * @param {Object} decoratorDict the input dict
     * @param {String} locale locale for target vocab
     * @returns {Array<Object>} the parsed decorator command set array
     */
    static parseVocabs(decoratorDict,locale){
        let data = [];
        Object.keys(decoratorDict).forEach((namespace)=>{
            let strVoc='';
            strVoc=strVoc+`locale: ${locale}\n`;
            strVoc=strVoc+`namespace: ${namespace}\n`;
            strVoc=strVoc+'declarations:\n';
            let jsonData=decoratorDict[namespace];
            let dictVoc={};
            jsonData.forEach((obj)=>{
                // check if obj.decl already in dictVoc
                if (!dictVoc[obj.declaration]){
                    dictVoc[obj.declaration]={
                        propertyVocabs:{}
                    };
                }
                let decos=JSON.parse(obj.dcs);
                decos.forEach((dcs)=>{
                    if (dcs.name==='Term' || dcs.name==='Term_description'){
                        if (obj.property!==''){
                            if(!dictVoc[obj.declaration].propertyVocabs[obj.property]){
                                dictVoc[obj.declaration].propertyVocabs[obj.property]={};
                            }
                            if (dcs.name==='Term'){
                                dictVoc[obj.declaration].propertyVocabs[obj.property].term=dcs.arguments[0].value;
                            }
                            else{
                                dictVoc[obj.declaration].propertyVocabs[obj.property].term=dcs.arguments[0].value;
                            }
                        }
                        else{
                            if (dcs.name==='Term'){
                                dictVoc[obj.declaration].term=dcs.arguments[0].value;
                            }
                            else{
                                dictVoc[obj.declaration].term_desc=dcs.arguments[0].value;
                            }
                        }
                    }
                });

            });
            Object.keys(dictVoc).forEach((decl)=>{
                if (dictVoc[decl].term){
                    strVoc+=`  - ${decl}: ${dictVoc[decl].term}\n`;
                    if (dictVoc[decl].term_desc){
                        strVoc+=`    description: ${dictVoc[decl].term_desc}\n`;
                    }
                    if (dictVoc[decl].propertyVocabs){
                        strVoc+='    properties:\n';
                        Object.keys(dictVoc[decl].propertyVocabs).forEach((prop)=>{
                            strVoc+=`      - ${prop}: ${dictVoc[decl].propertyVocabs[prop].term}\n`;
                            if (dictVoc[decl].term_desc){
                                strVoc+=`        description: ${dictVoc[decl].propertyVocabs[prop].term_desc}\n`;
                            }
                        });
                    }
                }
            });
            data.push(strVoc);
        });
        return data;
    }

    /**
     * Throws an error if the decoractor command is invalid
     * @param {ModelManager} validationModelManager the validation model manager
     * @param {*} command the decorator command
     */
    static validateCommand(validationModelManager, command) {
        if (command.target.type) {
            validationModelManager.resolveType(
                'DecoratorCommand.type',
                command.target.type
            );
        }
        let modelFile = null;
        if (command.target.namespace) {
            modelFile = validationModelManager.getModelFile(
                command.target.namespace
            );
            if (!modelFile) {
                const { name, version } = ModelUtil.parseNamespace(
                    command.target.namespace
                );
                if (!version) {
                    // does the model file exist with any version?
                    modelFile = validationModelManager
                        .getModelFiles()
                        .find((m) => isUnversionedNamespaceEqual(m, name));
                }
            }
        }
        if (command.target.namespace && !modelFile) {
            throw new Error(
                `Decorator Command references namespace "${
                    command.target.namespace
                }" which does not exist: ${JSON.stringify(command, null, 2)}`
            );
        }

        if (command.target.namespace && command.target.declaration) {
            validationModelManager.resolveType(
                'DecoratorCommand.target.declaration',
                `${modelFile.getNamespace()}.${command.target.declaration}`
            );
        }
        if (command.target.properties && command.target.property) {
            throw new Error(
                'Decorator Command references both property and properties. You must either reference a single property or a list of properites.'
            );
        }
        if (
            command.target.namespace &&
            command.target.declaration &&
            command.target.property
        ) {
            const decl = validationModelManager.getType(
                `${modelFile.getNamespace()}.${command.target.declaration}`
            );
            const property = decl.getProperty(command.target.property);
            if (!property) {
                throw new Error(
                    `Decorator Command references property "${command.target.namespace}.${command.target.declaration}.${command.target.property}" which does not exist.`
                );
            }
        }
        if (
            command.target.namespace &&
            command.target.declaration &&
            command.target.properties
        ) {
            const decl = validationModelManager.getType(
                `${modelFile.getNamespace()}.${command.target.declaration}`
            );
            command.target.properties.forEach((commandProperty) => {
                const property = decl.getProperty(commandProperty);
                if (!property) {
                    throw new Error(
                        `Decorator Command references property "${command.target.namespace}.${command.target.declaration}.${commandProperty}" which does not exist.`
                    );
                }
            });
        }
    }

    /**
     * Compares two arrays. If the first argument is falsy
     * the function returns true.
     * @param {string | string[] | null} test the value to test
     * @param {string[]} values the values to compare
     * @returns {Boolean} true if the test is falsy or the intersection of
     * the test and values arrays is not empty (i.e. they have values in common)
     */
    static falsyOrEqual(test, values) {
        return Array.isArray(test)
            ? intersect(test, values).length > 0
            : test
                ? values.includes(test)
                : true;
    }

    /**
     * Applies a decorator to a decorated model element.
     * @param {*} decorated the type to apply the decorator to
     * @param {string} type the command type
     * @param {*} newDecorator the decorator to add
     */
    static applyDecorator(decorated, type, newDecorator) {
        if (type === 'UPSERT') {
            let updated = false;
            if (decorated.decorators) {
                for (let n = 0; n < decorated.decorators.length; n++) {
                    let decorator = decorated.decorators[n];
                    if (decorator.name === newDecorator.name) {
                        decorated.decorators[n] = newDecorator;
                        updated = true;
                    }
                }
            }

            if (!updated) {
                decorated.decorators
                    ? decorated.decorators.push(newDecorator)
                    : (decorated.decorators = [newDecorator]);
            }
        } else if (type === 'APPEND') {
            decorated.decorators
                ? decorated.decorators.push(newDecorator)
                : (decorated.decorators = [newDecorator]);
        } else {
            throw new Error(`Unknown command type ${type}`);
        }
    }

    /**
     * Executes a Command against a ClassDeclaration, adding
     * decorators to the ClassDeclaration, or its properties, as required.
     * @param {string} namespace the namespace for the declaration
     * @param {*} declaration the class declaration
     * @param {*} command the Command object from the
     * org.accordproject.decoratorcommands model
     */
    static executeCommand(namespace, declaration, command) {
        const { target, decorator, type } = command;
        const { name } = ModelUtil.parseNamespace(namespace);
        if (
            this.falsyOrEqual(target.namespace, [namespace, name]) &&
            this.falsyOrEqual(target.declaration, [declaration.name])
        ) {
            if (!target.property && !target.type) {
                this.applyDecorator(declaration, type, decorator);
            } else {
                // scalars are declarations but do not have properties
                if (declaration.properties) {
                    declaration.properties.forEach((property) => {
                        DecoratorManager.executePropertyCommand(
                            property,
                            command
                        );
                    });
                }
            }
        }
    }

    /**
     * Executes a Command against a Property, adding
     * decorators to the Property as required.
     * @param {*} property the property
     * @param {*} command the Command object from the
     * org.accordproject.decoratorcommands model
     */
    static executePropertyCommand(property, command) {
        const { target, decorator, type } = command;
        if (
            this.falsyOrEqual(
                target.property ? target.property : target.properties,
                [property.name]
            ) &&
            this.falsyOrEqual(target.type, [property.$class])
        ) {
            this.applyDecorator(property, type, decorator);
        }
    }
    /**
     * extracts a Command from a ClassDeclaration or its properties, as required.
     * @param {String} namespace the namespace for the declaration
     * @param {*} declaration the class declaration
     * @param {Object} decoratorDict the dictionary with extracted decorators
     * @param {boolean} shouldRemoveDecorators whether to remove decorators from base model
     */
    static extractDecoratorFromModel(namespace, declaration, decoratorDict, shouldRemoveDecorators) {
        this.processDecorators(namespace, declaration.decorators, decoratorDict, shouldRemoveDecorators,declaration.name,'');
        if (declaration.properties) {
            declaration.properties.forEach((property) => {
                this.processDecorators(namespace, property.decorators, decoratorDict, shouldRemoveDecorators,declaration.name,property.name);
            });
        }
    }
    /**
    * Process decorators for a given set of decorators.
    * @param {string} namespace - The namespace to associate with the decorators.
    * @param {Array<string>} decorators - The array of decorators to process.
    * @param {Object} decoratorDict - The decorator dictionary to store the decorators.
    * @param {boolean} shouldRemoveDecorators - A flag to indicate whether decorators hould be removed.
    * @param {string} decl - declaration on which decorator has been applied
    * @param {string} property - property on which decorator has been applied
    */
    static processDecorators(namespace, decorators, decoratorDict, shouldRemoveDecorators,decl,property) {
        this.addToDict(decoratorDict, namespace, decorators,decl,property);
        if (shouldRemoveDecorators && decorators) {
            decorators.length = 0; // Clears the array in an efficient way
        }
    }
}

module.exports = DecoratorManager;
