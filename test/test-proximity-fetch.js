var sys = require('sys');
var assert = require('assert');
var log4js = require('log4js-node');
log4js.addAppender(log4js.consoleAppender());
log4js.addAppender(log4js.fileAppender('./test-proximity-fetch.log'), 'test-proximity-fetch');
var logger = log4js.getLogger('test-proximity-fetch');
logger.setLevel('INFO');
var GeoCell = require('geomodel').create_geo_cell(logger);
var _ = require('underscore')._;

var flatiron = {
    key: 'Flatiron', 
    location: GeoCell.create_point(40.7407092, -73.9894039)
  };
var outback = {
    key: 'Outback Steakhouse', 
    location: GeoCell.create_point(40.7425610, -73.9922670)
  };
var museum_of_sex = {
    key: 'Museum of Sex', 
    location: GeoCell.create_point(40.7440290, -73.9873500)
  };
var wolfgang = {
    key: 'Wolfgang Steakhouse', 
    location: GeoCell.create_point(40.7466230, -73.9820620)
  };
var morgan =  {
    key: 'Morgan Library', 
    location: GeoCell.create_point(40.7493672, -73.9817685)
  };

var objects = [flatiron, outback, museum_of_sex, wolfgang, morgan];
objects.forEach(function(o) {
  o.geocells = GeoCell.generate_geo_cell(o.location);
  logger.debug('Geocells for ' + o.key + ': ' + sys.inspect(o.geocells));
});

function test_proximity_fetch() {
  function execute_fetch(max_results, max_distance) {
    return GeoCell.proximity_fetch(flatiron.location, 
             function(geocells) {
               return _.reject(objects, function(o) {
                        return  (_.intersect(o.geocells, geocells).length < 0);
                      });
             }, 
             max_results, max_distance);
  }

  function assert_proximity_results_contain(expected, actual) {
    assert.ok(_.all(expected, function(o) {
                var objects = _.map(actual, function(res) {return res[0]})
                return _.include(objects, o);
              }),
              "Proximity results does not include all expected objects: " + 
    _.map(expected, function(o) { return o.key }));
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
  var proximity_results = execute_fetch(5, 500);
  assert.ok(proximity_results.length <= 5, "Too many results");
  assert_proximity_results_distances(proximity_results, 500);
  assert_proximity_results_contain([flatiron, outback, museum_of_sex], 
                                   proximity_results);

  // test max results is respected
  proximity_results = execute_fetch(2, 500);
  assert.ok(proximity_results.length <= 2, "Too many results");
  assert_proximity_results_distances(proximity_results, 500);
  assert_proximity_results_contain([flatiron, outback], 
                                   proximity_results);

  // increase the range
  proximity_results = execute_fetch(5, 1500);
  assert_proximity_results_distances(proximity_results, 1500);
  assert_proximity_results_contain([flatiron, outback, museum_of_sex, morgan], 
                                   proximity_results);

  logger.info("test_proximity_fetch successful.");
}

setTimeout(test_proximity_fetch, 0);