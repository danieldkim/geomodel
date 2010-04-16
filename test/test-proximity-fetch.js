var sys = require('sys');
var assert = require('assert');
var log4js = require('log4js-node');
log4js.addAppender(log4js.consoleAppender());
log4js.addAppender(log4js.fileAppender('./test-proximity-fetch.log'), 'test-proximity-fetch');
var logger = log4js.getLogger('test-proximity-fetch');
logger.setLevel('INFO');
var Geomodel = require('geomodel').create_geomodel(logger);
var _ = require('underscore')._;

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

var objects = [flatiron, outback, museum_of_sex, wolfgang, morgan];
objects.forEach(function(o) {
  o.geocells = Geomodel.generate_geo_cell(o.location);
  // logger.debug('Geocells for ' + o.id + ': ' + sys.inspect(o.geocells));
});

function test_proximity_fetch() {
  function execute_fetch(max_results, max_distance, event_listeners) {
    Geomodel.proximity_fetch(flatiron.location, 
      function(geocells, event_listeners) {
        var obj_results = _.reject(objects, function(o) {
          return  (_.intersect(o.geocells, geocells).length < 0);
        })
        event_listeners.success(obj_results);
      }, {
        success: function(proximity_results) {
          event_listeners.success(proximity_results);
        },
        error: function(mess) {
          event_listeners.error(mess);         
        }
      },
      max_results, max_distance);
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
  execute_fetch(5, 500, {
    success: function(proximity_results) {
      assert.ok(proximity_results.length <= 5, "Too many results");
      assert_proximity_results_distances(proximity_results, 500);
      assert_proximity_results_contain([flatiron, outback, museum_of_sex], 
                                       proximity_results);      
     logger.info("basic test successful.");
    },
    error: function(mess) {
      logger.info("Error executing basic test: " + mess);
    }
  });
  
  // test max results is respected
  execute_fetch(2, 500, {
    success: function(proximity_results) {
      assert.ok(proximity_results.length <= 2, "Too many results");
      assert_proximity_results_distances(proximity_results, 500);
      assert_proximity_results_contain([flatiron, outback], 
                                       proximity_results);
      logger.info("test max results successful.");
     },
    error: function(mess) {
      logger.info("Error executing test max results: " + mess);
    }
   });
  
  // // increase the range
  execute_fetch(5, 1000, {
    success: function(proximity_results) {
      assert_proximity_results_distances(proximity_results, 1000);
      assert_proximity_results_contain([flatiron, outback, museum_of_sex, wolfgang], 
                                       proximity_results);
     logger.info("increasing the range result successful.");
    },
    error: function(mess) {
      logger.info("Error executing test increasing the range: " + mess);
    }
  });

}

setTimeout(test_proximity_fetch, 0);