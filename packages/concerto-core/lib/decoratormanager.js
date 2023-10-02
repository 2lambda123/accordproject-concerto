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
    o String element optional
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
            const validationModelManager = new ModelManager({
                strict: true,
                metamodelValidation: true,
                addMetamodel: true,
            });
            validationModelManager.addModelFiles(modelManager.getModelFiles());
            validationModelManager.addCTOModel(
                DCS_MODEL,
                'decoratorcommands@0.2.0.cto'
            );
            const factory = new Factory(validationModelManager);
            const serializer = new Serializer(factory, validationModelManager);
            serializer.fromJSON(decoratorCommandSet);
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
        const { name } = ModelUtil.parseNamespace( namespace );
        if (this.falsyOrEqual(target.namespace, [namespace,name]) &&
            this.falsyOrEqual(target.declaration, [declaration.name])) {

            if (declaration.$class === 'concerto.metamodel@1.0.0.MapDeclaration') {
                if (target.element) {
                    switch(target.element.toLowerCase()) {
                    case 'key':
                        if (target.type) {
                            if (this.falsyOrEqual(target.type, declaration.key.$class)) {
                                this.applyDecorator(declaration.key, type, decorator);
                            }
                        } else {
                            this.applyDecorator(declaration.key, type, decorator);
                        }
                        break;
                    case 'value':
                        if (target.type) {
                            if (this.falsyOrEqual(target.type, declaration.value.$class)) {
                                this.applyDecorator(declaration.value, type, decorator);
                            }
                        } else {
                            this.applyDecorator(declaration.key, type, decorator);
                        }
                        break;
                    case '*':
                        if (target.type) {
                            if (this.falsyOrEqual(target.type, declaration.key.$class)) {
                                this.applyDecorator(declaration.key, type, decorator);
                            }
                            if (this.falsyOrEqual(target.type, declaration.value.$class)) {
                                this.applyDecorator(declaration.value, type, decorator);
                            }
                        } else {
                            this.applyDecorator(declaration.key, type, decorator);
                            this.applyDecorator(declaration.value, type, decorator);
                        }

                        break;
                    default:
                        throw new Error('Decorator Command contains invalid target element: ' + target.element );
                    }
                } else if (target.type) {
                    if (this.falsyOrEqual(target.type, declaration.key.$class)) {
                        this.applyDecorator(declaration.key, type, decorator);
                    }
                    if (this.falsyOrEqual(target.type, declaration.value.$class)) {
                        this.applyDecorator(declaration.value, type, decorator);
                    }
                }
            } else if (!target.property && !target.type) {
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
}

module.exports = DecoratorManager;
