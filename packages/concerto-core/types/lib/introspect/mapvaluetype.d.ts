export = MapValueType;
/**
 * MapValueType defines a Value type of MapDeclaration.
 *
 * @extends Decorated
 * @see See {@link Decorated}
 * @class
 * @memberof module:concerto-core
 */
declare class MapValueType extends Decorated {
    /**
     * Create an MapValueType.
     * @param {MapDeclaration} parent - The owner of this property
     * @param {Object} ast - The AST created by the parser
     * @throws {IllegalModelException}
     */
    constructor(parent: MapDeclaration, ast: any);
    parent: MapDeclaration;
    /**
     * Semantic validation of the structure of this class.
     *
     * @throws {IllegalModelException}
     * @protected
     */
    protected validate(): void;
    /**
     * Sets the Type name for the Map Value
     *
     * @param {Object} ast - The AST created by the parser
     * @private
     */
    private processType;
    /**
    * Returns the owner of this property
     * @public
     * @return {MapDeclaration} the parent map declaration
     */
    public getParent(): MapDeclaration;
    /**
     * Returns true if this class is the definition of a Map Key.
     *
     * @return {boolean} true if the class is a Map Key
     */
    isKey(): boolean;
    /**
     * Returns true if this class is the definition of a Map Value.
     *
     * @return {boolean} true if the class is a Map Value
     */
    isValue(): boolean;
    /**
     * Returns the corresponding ClassDeclaration representation of the Type
     *
     * @param {string} type - the Type of the Map Value
     * @return {Object} the corresponding ClassDeclaration representation
     * @private
     */
    private getTypeDeclaration;
}
import Decorated = require("./decorated");
import MapDeclaration = require("./mapdeclaration");
