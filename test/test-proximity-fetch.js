var util = require('util');
var assert = require('assert');
var log4js = require('log4js');
log4js.configure({
  appenders: [
    { type: 'console' },
    { type: 'file', filename: './test-proximity-fetch.log', category: 'test-proximity-fetch' }
  ]});
var logger = log4js.getLogger('test-proximity-fetch');
logger.setLevel('INFO');
var Geomodel = require('../geomodel').create_geomodel(logger);
var _ = require('underscore')._;

//TODO: perhaps Geomodel should expose this?
var MAX_GEOCELL_RESOLUTION = 13

var flatiron = {
    id: 'Flatiron',
    location: Geomodel.create_point(40.7407092, -73.9894039)
  };
var outback = {
    id: 'Outback Steakhouse',
    location: Geomodel.create_point(40.7425610, -73.9922670)
  };
var museum_of_sex = {
    id: 'Museum of Sex',
    location: Geomodel.create_point(40.7440290, -73.9873500)
  };
var wolfgang = {
    id: 'Wolfgang Steakhouse',
    location: Geomodel.create_point(40.7466230, -73.9820620)
  };
var morgan =  {
    id: 'Morgan Library',
    location: Geomodel.create_point(40.7493672, -73.9817685)
  };

var cell8 = {
    id: 'On cell 8 side',
    location: Geomodel.create_point(43.194093, -90.000370)
  };
var cell9 = {
    id: 'On cell 9 side',
    location: Geomodel.create_point(43.194118, -89.999820)
  };

var objects = [flatiron, outback, museum_of_sex, wolfgang, morgan];
objects.forEach(function(o) {
  o.geocells = Geomodel.generate_geocells(o.location);
  // logger.debug('Geocells for ' + o.id + ': ' + util.inspect(o.geocells));
});

function test_proximity_fetch() {
  function execute_fetch(max_results, max_distance, callback) {
    Geomodel.proximity_fetch(flatiron.location, max_results, max_distance,
      function(geocells, finder_callback) {
        var obj_results = _.reject(objects, function(o) {
          return  (_.intersection(o.geocells, geocells).length < 0);
        })
        finder_callback(null, obj_results);
      }, callback);
  }

  function assert_proximity_results_contain(expected, actual) {
    assert.equal(expected.length, actual.length,
                 "Expected proximity result size of " + expected.length +
                   ", not " + actual.length);
    assert.ok(_.all(expected, function(o) {
                var objects = _.map(actual, function(res) {return res[0]})
                return _.include(objects, o);
              }),
              "Proximity results does not include all expected objects: " +
    _.map(expected, function(o) { return o.id }));
  }

  function assert_proximity_results_distances(proximity_results, max) {
    // test that all distances are less than or equal to max
    assert.ok(_.all(proximity_results, function(res) { return res[1] <= max }),
             "Proximity results contain distance greater than " +max);
     var last;
     proximity_results.forEach(function(res) {
       if (last)
         assert.ok(res[1] >= last[1],
                   "Proximity results are not ordered by distance properly.");
       last = res;
     });
  }

  // basic test
  execute_fetch(5, 500, function(err, proximity_results) {
    if (err) logger.info("Error executing basic test: " + mess);
    else {
      assert.ok(proximity_results.length <= 5, "Too many results");
      assert_proximity_results_distances(proximity_results, 500);
      assert_proximity_results_contain([flatiron, outback, museum_of_sex],
                                       proximity_results);
     logger.info("basic test successful.");
    }
  });

  // test max results is respected
  execute_fetch(2, 500, function(err, proximity_results) {
    if (err) logger.info("Error executing test max results: " + mess);
    else {
      assert.ok(proximity_results.length <= 2, "Too many results");
      assert_proximity_results_distances(proximity_results, 500);
      assert_proximity_results_contain([flatiron, outback],
                                       proximity_results);
      logger.info("test max results successful.");
    }
   });

  // // increase the range
  execute_fetch(5, 1000, function(err, proximity_results) {
    if (err) logger.info("Error executing test increasing the range: " + mess);
    else {
      assert_proximity_results_distances(proximity_results, 1000);
      assert_proximity_results_contain([flatiron, outback, museum_of_sex, wolfgang],
                                       proximity_results);
     logger.info("increasing the range result successful.");
    }
  });

}

setTimeout(test_proximity_fetch, 0);

function test_best_bbox_search_cells_across_major_cell_boundary() {
  var result, bbox = Geomodel.create_bounding_box(43.195111, -89.998193, 43.19302, -90.002356);
  result = Geomodel.best_bbox_search_cells(bbox);
  logger.info("best bounding box across fault lines successful");
}

function test_best_bbox_search_cells_max_resolution() {
  var result, bbox = Geomodel.create_bounding_box(43.195110, -89.998193, 43.195110, -89.998193);
  result = Geomodel.best_bbox_search_cells(bbox, function(num_cells, resolution) {
    return resolution <= MAX_GEOCELL_RESOLUTION ? 0 : Math.exp(10000);
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 13);
  logger.info("best bounding box at max resolution successful");
}
test_best_bbox_search_cells_across_major_cell_boundary();
test_best_bbox_search_cells_max_resolution();


