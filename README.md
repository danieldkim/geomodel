# geomodel.js

This library is an implementation of the Geomodel/Geocell concept:

http://code.google.com/apis/maps/articles/geospatial.html

It is a direct port of the Java and Python versions of the geomodel project:

- http://code.google.com/p/javageomodel/
- http://code.google.com/p/geomodel/

Most of the code for the core Geocell concept was ported from the Java version.
The proximity\_fetch implementation was ported from the Python version, with 
the "entity" store abstracted out to remove the coupling to Google App Engine.
Also, this proximity\_fetch does not directly support the execution of an
additional query to filter the promixity results with, though this could be
implemented in whatever entity finder function the user passes to it.   

A geocell is a hexadecimal string that defines a two dimensional rectangular
region inside the [-90,90] x [-180,180] latitude/longitude space. A geocell's
'resolution' is its length. For most practical purposes, at high resolutions,
geocells can be treated as single points.

Much like geohashes (see http://en.wikipedia.org/wiki/Geohash), geocells are 
hierarchical, in that any prefix of a geocell is considered its ancestor, with
geocell[:-1] being geocell's immediate parent cell.

To calculate the rectangle of a given geocell string, first divide the
[-90,90] x [-180,180] latitude/longitude space evenly into a 4x4 grid like so:

<pre>
               +---+---+---+---+ (90, 180)
               | a | b | e | f |
               +---+---+---+---+
               | 8 | 9 | c | d |
               +---+---+---+---+
               | 2 | 3 | 6 | 7 |
               +---+---+---+---+
               | 0 | 1 | 4 | 5 |
    (-90,-180) +---+---+---+---+
</pre>

NOTE: The point (0, 0) is at the intersection of grid cells 3, 6, 9 and c. And,
for example, cell 7 should be the sub-rectangle from (-45, 90) to (0, 180).   

Calculate the sub-rectangle for the first character of the geocell string and
re-divide this sub-rectangle into another 4x4 grid. For example, if the geocell
string is '78a', we will re-divide the sub-rectangle like so:

<pre>
                 .                   .
                 .                   .
             . . +----+----+----+----+ (0, 180)
                 | 7a | 7b | 7e | 7f |
                 +----+----+----+----+
                 | 78 | 79 | 7c | 7d |
                 +----+----+----+----+
                 | 72 | 73 | 76 | 77 |
                 +----+----+----+----+
                 | 70 | 71 | 74 | 75 |
    . . (-45,90) +----+----+----+----+
                 .                   .
                 .                   .
</pre>

Continue to re-divide into sub-rectangles and 4x4 grids until the entire
geocell string has been exhausted. The final sub-rectangle is the rectangular
region for the geocell.    

## Requirements

The code relies heavily on 
[Underscore.js](http://documentcloud.github.com/underscore/)

While not absolutely dependent on this, it is helpful to have 
[lo4js](http://log4js.berlios.de/).  If running on node.js, you can use 
[log4js-node](http://github.com/csausdev/log4js-node).

So far I've only tested this on [node.js](http://nodejs.org/).  Theoretically, 
the code should work with any JS engine, including browsers.

## Usage

Create a Geocell instance, passing in a <code>logger</code> object and an
<code>inspect</code> function:

    var log4js = require('log4js-node');
    var logger = log4js.getLogger('foo');  
    var Geocell = require('geomodel').create_geocell(logger, require('sys').inspect);

geomodel.js defaults the inspect parameter to '<code>require('sys').inspect</code>'
so you don't technically need to pass this if you are running on node.js.

If you don't have log4js and don't really care about logging, just create a 
Geocell instance with no params: 

    var Geocell = require('geomodel').create_geocell();

Generate geocells for your entities based on their location, and save them to 
your data source such that you can query for them by geocell later:

    my_obj.location = Geocell.create_point(40.7407092, -73.9894039)
    var geocells = Geocell.generate_geo_cell(my_obj.location)
    // then do some stuff to save my_obj to your data source, indexed by 
    // the generated geocells somehow 

All geocelled objects must have an 'id' and a 'location' property.  The location
property must be an object with a 'lat' and 'lon' property (the 
<code>create_point</code> function creates such an object).  These are used by
<code>proximity\_fetch</code>.

Call <code>proximity\_fetch</code> to find entities near a point, passing in a 
finder function and success and error handlers:

    var results = Geocell.proximity_fetch(my_point,
                    function(geocells, event_listeners) {
                      // this function should query your data source for all 
                      // the entities in the specified geocells and then return 
                      // them in an array like so:
                      event_listeners.success(entity_results);
                    }, {
                      success: function(proximity_results) {
                        // do what you want to do with the results here
                      },
                      error: function(mess) {
                        // handle errors from proximity_fetch here
                      }
                    },
                    max_results, max_distance);

The results are returned as a list of "2-tuples" where the first element of the 
tuple is the object and the second is the distance from the query point, sorted
by distance:

    proximity_results.forEach(function(res) { puts(res[0].key + ' is ' + res[1] + ' meters away.') })

For a full working example of these steps check out the code in tests/test-proximity-fetch.js.
    
## Author

Daniel Kim  
danieldkimster@gmail.com  
danieldkim on github

## License

The Java and python versions of this library were distributed under the 
Apache 2.0 License, and so is this.

