define([
    '../Core/BoundingSphere',
    '../Core/buildModuleUrl',
    '../Core/Cartesian3',
    '../Core/Cartographic',
    '../Core/Color',
    '../Core/defaultValue',
    '../Core/defined',
    '../Core/defineProperties',
    '../Core/Intersect',
    '../Core/Matrix4',
    '../Core/Plane'
], function(
    BoundingSphere,
    buildModuleUrl,
    Cartesian3,
    Cartographic,
    Color,
    defaultValue,
    defined,
    defineProperties,
    Intersect,
    Matrix4,
    Plane) {
    'use strict';

    /**
     * Specifies a set of clipping planes. Clipping planes selectively disable rendering in a region on the outside of the specified list of {@link Plane} objects.
     *
     * @alias ClippingPlanesCollection
     * @constructor
     *
     * @param {Object} [options] Object with the following properties:
     * @param {Plane[]} [options.planes=[]] An array of up to 6 {@link Plane} objects used to selectively disable rendering on the outside of each plane.
     * @param {Boolean} [options.enabled=true] Determines whether the clipping planes are active.
     * @param {Matrix4} [options.modelMatrix=Matrix4.IDENTITY] The 4x4 transformation matrix specifying an additional transform relative to the clipping planes original coordinate system.
     * @param {Boolean} [options.combineClippingRegions=true] If true, the region to be clipped must be included in all planes in this collection. Otherwise, a region will be clipped if included in any plane in the collection.
     * @param {Color} [options.edgeColor=Color.WHITE] The color applied to highlight the edge along which an object is clipped.
     * @param {Number} [options.edgeWidth=0.0] The width, in pixels, of the highlight applied to the edge along which an object is clipped.
     */
    function ClippingPlanesCollection(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        /**
         * An array of up to 6 {@link Plane} objects used to selectively disable rendering on the outside of each plane.
         *
         * @type {Plane}
         * @default []
         */
        this.planes = defaultValue(options.planes, []);

        /**
         * Determines whether the clipping planes are active.
         *
         * @type {Boolean}
         * @default true
         */
        this.enabled = defaultValue(options.enabled, true);

        /**
         * The 4x4 transformation matrix specifying an additional transform relative to the clipping planes original coordinate system.
         *
         * @type {Matrix4}
         * @default Matrix4.IDENTITY
         */
        this.modelMatrix = defaultValue(options.modelMatrix, Matrix4.clone(Matrix4.IDENTITY));

        /**
         * The color applied to highlight the edge along which an object is clipped.
         *
         * @type {Color}
         * @default Color.WHITE
         */
        this.edgeColor = defaultValue(options.edgeColor, Color.clone(Color.WHITE));

        /**
         * The width, in pixels, of the highlight applied to the edge along which an object is clipped.
         *
         * @type {Number}
         * @default 0.0
         */
        this.edgeWidth = defaultValue(options.edgeWidth, 0.0);

        this._testIntersection = undefined;
        this.combineClippingRegions = defaultValue(options.combineClippingRegions, true);
    }

    defineProperties(ClippingPlanesCollection.prototype, {
        /**
         * If true, the region to be clipped must be included in all planes in this collection.
         * Otherwise, a region will be clipped if included in any plane in the collection.
         *
         * @memberof ClippingPlanesCollection.prototype
         * @type {Boolean}
         * @default true
         */
        combineClippingRegions : {
            get : function() {
                return this._combineClippingRegions;
            },
            set : function(value) {
                if (this._combineClippingRegions !== value) {
                    this._combineClippingRegions = value;
                    this._testIntersection = getTestIntersectionFunction(value);
                }
            }
        }
    });

    function getTestIntersectionFunction(combineClippingRegions) {
        if (combineClippingRegions) {
            return function(value) {
                return (value === Intersect.INSIDE);
            };
        }

        return function(value) {
            return (value === Intersect.OUTSIDE);
        };
    }

    var scratchPlane = new Plane(Cartesian3.UNIT_X, 0.0);
    var scratchMatrix = new Matrix4();
    /**
     * Applies the transformations to each plane and packs it into an array.
     *
     * @param viewMatrix
     * @param [array]
     * @returns {Cartesian4[]} The array of packed planes.
     */
    ClippingPlanesCollection.prototype.transformAndPackPlanes = function(viewMatrix, array) {
        var planes = this.planes;
        var length = planes.length;

        if (!defined(array)) {
            array = new Array(length);
        }

        var transform = Matrix4.multiply(viewMatrix, this.modelMatrix, scratchMatrix);

        for (var i = 0; i < length; ++i) {
            var plane = planes[i];
            var packedPlane = array[i];

            Plane.transform(plane, transform, scratchPlane);

            Cartesian3.clone(scratchPlane.normal, packedPlane);
            packedPlane.w = scratchPlane.distance;
        }

        return array;
    };

    /**
     * Duplicates this ClippingPlanesCollection instance.
     *
     * @param {ClippingPlanesCollection} [result] The object onto which to store the result.
     * @returns he modified result parameter or a new ClippingPlanesCollection instance if one was not provided.
     */
    ClippingPlanesCollection.prototype.clone = function(result) {
        if (!defined(result)) {
            result = new ClippingPlanesCollection();
        }

        result.planes = Array.from(this.planes);
        result.enabled = this.enabled;
        Matrix4.clone(this.modelMatrix, result.modelMatrix);
        result.combineClippingRegions = this.combineClippingRegions;
        Color.clone(this.edgeColor, result.edgeColor);
        result.edgeWidth = this.edgeWidth;

        return result;
    };

    /**
     * Determines the type intersection with the planes of this bounding collection and the specified {@link BoundingVolume}.
     *
     * @param {BoundingVolume} boundingVolume The volume to determine the intersection with the planes.
     * @param {Matrix4} [parentTransform] An optional, additional matrix to transform the plane to world coordinates.
     * @returns {Intersect} {@link Intersect.INSIDE} if the entire volume is on the side of the planes
     *                      the normal is pointing and should be entirely rendered, {@link Intersect.OUTSIDE}
     *                      if the entire volume is on the opposite side and should be clipped, and
     *                      {@link Intersect.INTERSECTING} if the volume intersects the planes.
     */
    ClippingPlanesCollection.prototype.computeIntersectionWithBoundingVolume = function(boundingVolume, parentTransform) {
        var planes = this.planes;
        var length = planes.length;

        var transform = this.modelMatrix;
        if (defined(parentTransform)) {
            transform = Matrix4.multiply(transform, parentTransform, scratchMatrix);
        }

        // If the clipping planes are using combineClippingRegions, the volume must be outside of all planes to be considered
        // completely clipped. Otherwise, if the volume can be outside any the planes, it is considered completely clipped.
        // Lastly, if not completely clipped, if any plane is intersecting, more calculations must be performed.
        var intersection = Intersect.INSIDE;
        if (this.combineClippingRegions && length > 0) {
            intersection = Intersect.OUTSIDE;
        }

        for (var i = 0; i < length; ++i) {
            var plane = planes[i];

            Plane.transform(plane, transform, scratchPlane);

            var value = boundingVolume.intersectPlane(scratchPlane);
            if (value === Intersect.INTERSECTING) {
                intersection = value;
            } else if (this._testIntersection(value)) {
                return value;
            }
        }

        return intersection;
    };

    return ClippingPlanesCollection;
});
