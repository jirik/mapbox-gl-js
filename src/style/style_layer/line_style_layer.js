// @flow

const Point = require('@mapbox/point-geometry');

const StyleLayer = require('../style_layer');
const LineBucket = require('../../data/bucket/line_bucket');
const RGBAImage = require('../../util/image').RGBAImage;
const {multiPolygonIntersectsBufferedMultiLine} = require('../../util/intersection_tests');
const {getMaximumPaintValue, translateDistance, translate} = require('../query_utils');
const properties = require('./line_style_layer_properties');
const {extend} = require('../../util/util');
const EvaluationParameters = require('../evaluation_parameters');

const {
    Transitionable,
    Transitioning,
    Layout,
    PossiblyEvaluated,
    DataDrivenProperty
} = require('../properties');

import type {Bucket, BucketParameters} from '../../data/bucket';
import type {LayoutProps, PaintProps} from './line_style_layer_properties';

class LineFloorwidthProperty extends DataDrivenProperty<number> {
    useIntegerZoom: true;

    possiblyEvaluate(value, parameters) {
        parameters = new EvaluationParameters(Math.floor(parameters.zoom), {
            now: parameters.now,
            fadeDuration: parameters.fadeDuration,
            zoomHistory: parameters.zoomHistory,
            transition: parameters.transition
        });
        return super.possiblyEvaluate(value, parameters);
    }

    evaluate(value, globals, feature) {
        globals = extend({}, globals, {zoom: Math.floor(globals.zoom)});
        return super.evaluate(value, globals, feature);
    }
}

const lineFloorwidthProperty = new LineFloorwidthProperty(properties.paint.properties['line-width'].specification);
lineFloorwidthProperty.useIntegerZoom = true;

class LineStyleLayer extends StyleLayer {
    _unevaluatedLayout: Layout<LayoutProps>;
    layout: PossiblyEvaluated<LayoutProps>;

    gradient: ?RGBAImage;
    gradientTexture: ?Texture;

    _transitionablePaint: Transitionable<PaintProps>;
    _transitioningPaint: Transitioning<PaintProps>;
    paint: PossiblyEvaluated<PaintProps>;

    constructor(layer: LayerSpecification) {
        super(layer, properties);
    }

    setPaintProperty(name: string, value: mixed, options: {validate: boolean}) {
        super.setPaintProperty(name, value, options);
        if (name === 'line-gradient') {
            this._updateGradient();
        }
    }

    _updateGradient() {
        const expression = this._transitionablePaint._values['line-gradient'].value.expression;
        const gradientData = new Uint8Array(256 * 4);
        const len = gradientData.length;
        for (let i = 4; i < len; i += 4) {
            const pxColor = expression.evaluate(({lineProgress: i / len}: any));
            // the colors are being unpremultiplied because Color uses
            // premultiplied values, and the Texture class expects unpremultiplied ones
            gradientData[i + 0] = Math.floor(pxColor.r * 255 / pxColor.a);
            gradientData[i + 1] = Math.floor(pxColor.g * 255 / pxColor.a);
            gradientData[i + 2] = Math.floor(pxColor.b * 255 / pxColor.a);
            gradientData[i + 3] = Math.floor(pxColor.a * 255);
        }
        this.gradient = new RGBAImage({width: 256, height: 1}, gradientData);
        this.gradientTexture = null;
    }

    recalculate(parameters: EvaluationParameters) {
        super.recalculate(parameters);

        (this.paint._values: any)['line-floorwidth'] =
            lineFloorwidthProperty.possiblyEvaluate(this._transitioningPaint._values['line-width'].value, parameters);
    }

    createBucket(parameters: BucketParameters<*>) {
        return new LineBucket(parameters);
    }

    queryRadius(bucket: Bucket): number {
        const lineBucket: LineBucket = (bucket: any);
        const width = getLineWidth(
            getMaximumPaintValue('line-width', this, lineBucket),
            getMaximumPaintValue('line-gap-width', this, lineBucket));
        const offset = getMaximumPaintValue('line-offset', this, lineBucket);
        return width / 2 + Math.abs(offset) + translateDistance(this.paint.get('line-translate'));
    }

    queryIntersectsFeature(queryGeometry: Array<Array<Point>>,
                           feature: VectorTileFeature,
                           geometry: Array<Array<Point>>,
                           zoom: number,
                           bearing: number,
                           pixelsToTileUnits: number): boolean {
        const translatedPolygon = translate(queryGeometry,
            this.paint.get('line-translate'),
            this.paint.get('line-translate-anchor'),
            bearing, pixelsToTileUnits);
        const halfWidth = pixelsToTileUnits / 2 * getLineWidth(
            this.paint.get('line-width').evaluate(feature),
            this.paint.get('line-gap-width').evaluate(feature));
        const lineOffset = this.paint.get('line-offset').evaluate(feature);
        if (lineOffset) {
            geometry = offsetLine(geometry, lineOffset * pixelsToTileUnits);
        }
        return multiPolygonIntersectsBufferedMultiLine(translatedPolygon, geometry, halfWidth);
    }
}

module.exports = LineStyleLayer;

function getLineWidth(lineWidth, lineGapWidth) {
    if (lineGapWidth > 0) {
        return lineGapWidth + 2 * lineWidth;
    } else {
        return lineWidth;
    }
}

function offsetLine(rings, offset) {
    const newRings = [];
    const zero = new Point(0, 0);
    for (let k = 0; k < rings.length; k++) {
        const ring = rings[k];
        const newRing = [];
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i - 1];
            const b = ring[i];
            const c = ring[i + 1];
            const aToB = i === 0 ? zero : b.sub(a)._unit()._perp();
            const bToC = i === ring.length - 1 ? zero : c.sub(b)._unit()._perp();
            const extrude = aToB._add(bToC)._unit();

            const cosHalfAngle = extrude.x * bToC.x + extrude.y * bToC.y;
            extrude._mult(1 / cosHalfAngle);

            newRing.push(extrude._mult(offset)._add(b));
        }
        newRings.push(newRing);
    }
    return newRings;
}
