import { ClassDeclaration, ModelFile, ModelManager, Property, Validator, Field } from '@accordproject/concerto-core';
import { getDeclarationType, getPropertyType, getValidatorType } from '../../src/compare-utils';

// This test suite should disappear once we port concerto-core to TypeScript because the error branches will be enforced by the transpiler.

const modelManager = new ModelManager();
const propertyAst = {
    $class: 'concerto.metamodel@1.0.0.BooleanProperty',
    name: 'myProp',
    type: 'Boolean'
};
const modelAst = {
    $class: 'concerto.metamodel@1.0.0.UnknownDeclaration',
    name: 'Unknown',
    namespace: 'foo@1.0.0',
    properties: []
};
const modelFile = new ModelFile(modelManager, modelAst);
const classDeclaration = new ClassDeclaration(modelFile, modelAst);
const property = new Property(classDeclaration, propertyAst);
const field = new Field(classDeclaration, propertyAst);
const validator = new Validator(field, {});

test('should throw for unknown class declaration type', () => {
    expect(() => getDeclarationType(classDeclaration)).toThrow('unknown class declaration type "ClassDeclaration {id=foo@1.0.0.Unknown super=Concept declarationKind=UnknownDeclaration abstract=false idField=null}"');
});

test('should throw for unknown thing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => getDeclarationType('thing' as any)).toThrow('unknown declaration type "thing"');
});

test('should throw for unknown class property type', () => {
    expect(() => getPropertyType(property)).toThrow('unknown property type "BooleanProperty {id=foo@1.0.0.Unknown.myProp}"');
});

test('should throw for unknown validator type', () => {
    expect(() => getValidatorType(validator)).toThrow('unknown validator type "[object Object]');
});
