'use strict';

var _ = require('underscore'),
    la = require('sylvester'),
    Matrix = la.Matrix,
    Vector = la.Vector;

var ransac  = require('./ransac.js'),
    lma     = require('../math/levenberg-marquardt.js'),
    cord    = require('../utils/cord.js'),
    laUtils = require('../math/la-utils.js');

//=================================================


/**
 * Normalized eight point algorithm to filter matches and estimate Fmatrix
 * @param {int[][]} matches
 * @param {TwoViewMetadata} metadata
 * @returns {{ dataset: int[][], F: Matrix }}
 */
module.exports = function(matches, metadata){

    var cam1 = metadata.cam1,
        cam2 = metadata.cam2,
        features1 = metadata.features1,
        features2 = metadata.features2;

    var T1 = Matrix.create([
        [ 1/cam1.width, 0            , 0 ],
        [ 0           , 1/cam1.height, 0 ],
        [ 0           , 0            , 1 ]
    ]);

    var T2 = Matrix.create([
        [ 1/cam2.width, 0            , 0 ],
        [ 0           , 1/cam2.height, 0 ],
        [ 0           , 0            , 1 ]
    ]);

    var normalizedMatches = matches.map(function(match){
        var f1 = features1[match[0]],
            f2 = features2[match[1]],
            p1 = Vector.create(cord.featureToImg(f1)),
            p2 = Vector.create(cord.featureToImg(f2));
        return { x1: T1.x(p1), x2: T2.x(p2) };
    });

    var results = ransac({
        dataset: normalizedMatches,
        metadata: null,
        subset: 10,
        relGenerator: module.exports.estimateFmatrix,
        errorGenerator: module.exports.fmatrixError,
        outlierThreshold: 0.15,
        errorThreshold: 0.004,
        trials: 2000
    });

    var F = module.exports.refineFmatrix(results.rel, results.dataset);

    F = T1.transpose().x(F).x(T2);

    var filteredMatches = results.dataset.map(function(pair){
        var i = normalizedMatches.indexOf(pair);
        if (i === -1) {
            throw 'Match not fount while constructing filtered matches';
        }
        else {
            return matches[i];
        }
    });

    return {
        dataset: filteredMatches,
        F: F
    };

};


/**
 * recover fmatrix from image cord pairs using svd
 * @param {{x1: Vector, x2: Vector}[]} matches - in image cord
 * @returns {Matrix}
 */
module.exports.estimateFmatrix = function(matches){

    var A = Matrix.create(matches.map(function(match){
        var x1 = match.x1.elements,
            x2 = match.x2.elements,
            p1 = Matrix.create(x1),
            p2 = Matrix.create([x2]);
        return _.flatten(p1.x(p2).elements);
    }));

    var solve = laUtils.svdSolve(A);

    return laUtils.inflateVector(solve, 3, 3);

};


/**
 * fundamental matrix error for a match
 * @param {Matrix} F
 * @param {PointMatch} match
 * @return {number}
 */
module.exports.fmatrixError = function(F, match){
    var p1 = match.x1,
        p2 = match.x2,
        line = F.x(p2),
        a = line.e(1), b = line.e(2),
        modulus = Math.sqrt(a*a+b*b);
    return Math.abs(p1.dot(line)/modulus);
};


/**
 * Refine Fmatrix using LMA
 * @param {Matrix} F
 * @param {PointMatch[]} matches
 * @returns {Matrix}
 */
module.exports.refineFmatrix = function(F, matches){

    var refined = lma(
        function(parameters){
            var currentF = laUtils.inflateVector(parameters, 3, 3);
            return Vector.create(matches.map(function(match){
                return module.exports.fmatrixError(currentF, match);
            }));
        },
        laUtils.flattenMatrix(F).x(10000000),
        Vector.Zero(matches.length)
    );

    return laUtils.inflateVector(refined, 3, 3);

};