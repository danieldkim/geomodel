/**
#
# Copyright 2010 Daniel Kim
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
*/

/**
 * This library is an implementation of the Geomodel/Geocell concept: 
 * http://code.google.com/apis/maps/articles/geospatial.html
 * 
 * It is a direct port of the Java and Python versions of the geomodel project:
 *
 * - http://code.google.com/p/javageomodel/
 * - http://code.google.com/p/geomodel/
 *
 * Most of the code for the core Geocell concept was ported from the Java version.
 * The proximity_fetch implementation was ported from the Python version, with 
 * the "entity" store abstracted out to remove the coupling to Google App Engine.
 * Also, this proximity_fetch does not directly support the execution of an  
 * additional query to filter the promixity results with, though this could be 
 * implemented in whatever entity finder function the user passes to it.
 *

	A geocell is a hexadecimal string that defines a two dimensional rectangular
	region inside the [-90,90] x [-180,180] latitude/longitude space. A geocell's
	'resolution' is its length. For most practical purposes, at high resolutions,
	geocells can be treated as single points.

	Much like geohashes (see http://en.wikipedia.org/wiki/Geohash), geocells are
	hierarchical, in that any prefix of a geocell is considered its ancestor, with
	geocell[:-1] being geocell's immediate parent cell.

	To calculate the rectangle of a given geocell string, first divide the
	[-90,90] x [-180,180] latitude/longitude space evenly into a 4x4 grid like so:

	             +---+---+---+---+ (90, 180)
	             | a | b | e | f |
	             +---+---+---+---+
	             | 8 | 9 | c | d |
	             +---+---+---+---+
	             | 2 | 3 | 6 | 7 |
	             +---+---+---+---+
	             | 0 | 1 | 4 | 5 |
	  (-90,-180) +---+---+---+---+

	NOTE: The point (0, 0) is at the intersection of grid cells 3, 6, 9 and c. And,
	      for example, cell 7 should be the sub-rectangle from
	      (-45, 90) to (0, 180).

	Calculate the sub-rectangle for the first character of the geocell string and
	re-divide this sub-rectangle into another 4x4 grid. For example, if the geocell
	string is '78a', we will re-divide the sub-rectangle like so:

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

	Continue to re-divide into sub-rectangles and 4x4 grids until the entire
	geocell string has been exhausted. The final sub-rectangle is the rectangular
	region for the geocell.
 * 
 * 
 * 
 */

try {
  var underscore = require('underscore')
} catch (e) {}

if (underscore) {
  var _ = underscore._
}

var no_op_fn = function() {}
var no_op_logger  = { isDebugEnabled: function() {return false} };
['debug', 'info', 'error', 'warn', 'fatal'].forEach(function(f) { no_op_logger[f] = no_op_fn }); 

if (typeof exports !== 'undefined') exports.create_geomodel = create_geomodel;

function create_geomodel(logger, inspect) {

  if ( ! logger ) {
    logger = no_op_logger
  }

  if ( !inspect ) {
    try {
      inspect = require('util').inspect
    } catch (e) {}
  }
  inspect = inspect || no_op_fn

	// Geocell algorithm constants.
  var GEOCELL_GRID_SIZE = 4;
  var GEOCELL_ALPHABET = "0123456789abcdef";

  // The maximum *practical* geocell resolution.
  var MAX_GEOCELL_RESOLUTION = 13;

  // The maximum number of geocells to consider for a bounding box search.
  var MAX_FEASIBLE_BBOX_SEARCH_CELLS = 300;

  // Direction enumerations.
  var NORTHWEST = [-1,1];
  var NORTH = [0,1];
  var NORTHEAST = [1,1];
  var EAST = [1,0];
  var SOUTHEAST = [1,-1];
  var SOUTH = [0,-1];
  var SOUTHWEST = [-1,-1];
  var WEST = [-1,0];

  var RADIUS = 6378135;
  var RADIUS_MI = 3963.2;

  // adding this which is used in the GeoCell.best_bbox_search_cells function
  String.prototype.startsWith = function(str) {return (this.match("^"+str)==str)}

  // adding the Array and String functions below, which are used by the 
  // interpolate function and others
  function arrayAddAll(target) {
    for (var a = 1;  a < arguments.length;  a++) {
      arr = arguments[a];
      for (var i = 0;  i < arr.length;  i++) {
        target.push(arr[i]);
      }
    }
  }

  function arrayGetLast(arr) { return arr[arr.length-1] }
  function arrayGetFirst(arr) { return arr[0] }
  String.prototype.equalsIgnoreCase = function(arg) {               
    return (new String(this.toLowerCase())==(new
                                             String(arg)).toLowerCase());
  }

  // this is used by the distance function
  Math.toRadians = function(deg) { return deg * this.PI / 180; }
  Math.toDegrees = function(rad) { return rad * 180 / this.PI; }

  // this is used by bounding_box_from_distance
  var MIN_LAT = Math.toRadians(-90);
  var MAX_LAT = Math.toRadians(90);
  var MIN_LON = Math.toRadians(-180);
  var MAX_LON = Math.toRadians(180);

  // used to implement comparator functions for sorting
  function cmp(x, y)  { return x < y ? -1 : (x == y ? 0 : 1); }

  /** Merges an arbitrary number of pre-sorted lists in-place, into the first
    * list, possibly pruning out duplicates. Source lists must not have
    * duplicates.
    *
    * Args:
    *  list1: The first, sorted list into which the other lists should be merged.
    *  list2: A subsequent, sorted list to merge into the first.
    *  ...
    *  listn:  "   "
    *  cmp_fn: An optional binary comparison function that compares objects across
    *      lists and determines the merged list's sort order.
    *  dup_fn: An optional binary comparison function that should return True if
    *      the given objects are equivalent and one of them can be pruned from the
    *      resulting merged list.
    *
    * Returns:
    *  list1, in-placed merged wit the other lists, or an empty list if no lists
    *  were specified.
    */
  function merge_in_place(lists, cmp_fn, dup_fn) {
    cmp_fn = cmp_fn || cmp

    if (!lists) return [];

    var reverse_indices = _.map(lists, function(arr) { return arr.length })
    var aggregate_reverse_index = _.reduce(reverse_indices, function(sum, len) {
                                    return sum + len 
                                  }, 0)

    while ( aggregate_reverse_index > 0 ) {
      var pull_arr_index = null, pull_val = null

      for (var i = 0; i < lists.length; i++) {
        if (reverse_indices[i] == 0) {
          // Reached the end of this list.
          continue;
        } else if ( pull_arr_index != null && dup_fn &&
                    dup_fn(lists[i][lists[i].length-reverse_indices[i]], pull_val) ) {
          // Found a duplicate, advance the index of the list in which the
          // duplicate was found.
          reverse_indices[i] -= 1
          aggregate_reverse_index -= 1
        } else if ( pull_arr_index == null ||
                    cmp_fn(lists[i][lists[i].length-reverse_indices[i]], pull_val) < 0 ) {
          // Found a lower value.
          pull_arr_index = i
          pull_val = lists[i][lists[i].length-reverse_indices[i]]
        }
      }
      if (pull_arr_index != 0) {
        // Add the lowest found value in place into the first array.
        lists[0].splice(lists[0].length - reverse_indices[0], 0, pull_val)
      }
      aggregate_reverse_index -= 1
      reverse_indices[pull_arr_index] -= 1
    }
    return lists[0]
  }

  return {  
    create_point: function(lat, lon) {
      if(lat > 90.0 || lat < -90.0) {
        throw new Error("Latitude must be in [-90, 90] but was " + lat);
      }
      if(lon > 180.0 || lon < -180.0) {
        throw new Error("Longitude must be in [-180, 180] but was " + lon);
      }
      return { lat: lat, lon:lon }
    }, 
  
    create_bounding_box: function(north, east, south, west) { 
      var north_,south_;

      if(south > north) {
        south_ = north;
        north_ = south;
      } else {
        south_ = south;
        north_ = north;
      }

      return {
      // Don't swap east and west to allow disambiguation of
      // antimeridian crossing.
        northEast: this.create_point(north_, east),
        southWest: this.create_point(south_, west),
        getNorth: function() {
          return this.northEast.lat;
        },
        getSouth: function() {
          return this.southWest.lat;
        },
        getWest: function() {
          return this.southWest.lon;
        },
        getEast: function() {
          return this.northEast.lon;
        }
      }
    },

    /**
     * Returns the list of geocells (all resolutions) that are containing the point
     * 
     * @param point
     * @return Returns the list of geocells (all resolutions) that are containing the point
     */
    generate_geocells: function(point) {
      var geocells = [];
      var geocellMax = this.compute(point, MAX_GEOCELL_RESOLUTION);
      for(var i = 1; i < MAX_GEOCELL_RESOLUTION; i++) {
        geocells.push(this.compute(point, i));
      }
      geocells.push(geocellMax);
      return geocells;
    },

    /**
     * Returns an efficient set of geocells to search in a bounding box query.

      This method is guaranteed to return a set of geocells having the same
      resolution.

     * @param bbox: A geotypes.Box indicating the bounding box being searched.
     * @param costFunction: A function that accepts two arguments:
            * num_cells: the number of cells to search
            * resolution: the resolution of each cell to search
            and returns the 'cost' of querying against this number of cells
            at the given resolution.)
     * @return A list of geocell strings that contain the given box.
     */
    best_bbox_search_cells: function(bbox, cost_function) {

      cost_function = cost_function || this.default_cost_function
      var cell_ne = this.compute(bbox.northEast, MAX_GEOCELL_RESOLUTION);
      var cell_sw = this.compute(bbox.southWest, MAX_GEOCELL_RESOLUTION);

      // The current lowest BBOX-search cost found; start with practical infinity.
      var min_cost = Number.MAX_VALUE;

      // The set of cells having the lowest calculated BBOX-search cost.
      var min_cost_cell_set = [];

      // First find the common prefix, if there is one.. this will be the base
      // resolution.. i.e. we don't have to look at any higher resolution cells.
      var min_resolution = 1;
      var max_resolution = Math.min(cell_ne.length, cell_sw.length);
      while(min_resolution < max_resolution  && 
            cell_ne.substring(0, min_resolution).startsWith(cell_sw.substring(0, min_resolution))) {
        min_resolution++;
      }

      // Iteravely calculate all possible sets of cells that wholely contain
      // the requested bounding box.
      var cur_ne, cur_sw, num_cells, cell_set, cost;
      for(var cur_resolution = min_resolution; 
          cur_resolution < MAX_GEOCELL_RESOLUTION + 1; 
          cur_resolution++) {
        cur_ne = cell_ne.substring(0, cur_resolution);
        cur_sw = cell_sw.substring(0, cur_resolution);

        num_cells = this.interpolation_count(cur_ne, cur_sw);
        if(num_cells > MAX_FEASIBLE_BBOX_SEARCH_CELLS) {
          continue;
        }

        cell_set = this.interpolate(cur_ne, cur_sw);
        cell_set.sort();

        cost = cost_function(cell_set.length, cur_resolution);

        if(cost <= min_cost) {
          min_cost = cost;
          min_cost_cell_set = cell_set;
        } else {
          if(min_cost_cell_set.length == 0) {
            min_cost_cell_set = cell_set;
          }
          // Once the cost starts rising, we won't be able to do better, so abort.
          break;
        }
      }
      return min_cost_cell_set;
    },

    /**
     * The default cost function, used if none is provided by the developer.
     *  
     * @param num_cells
     * @param resolution
     * @return
     */
    default_cost_function: function(num_cells, resolution) {
      return num_cells > Math.pow(GEOCELL_GRID_SIZE, 2) ? Math.exp(10000) : 0;
    },

    /**
     * Determines whether the given cells are collinear along a dimension.

        Returns True if the given cells are in the same row (column_test=False)
        or in the same column (column_test=True).

     * @param cell1: The first geocell string.
     * @param cell2: The second geocell string.
     * @param column_test: A boolean, where False invokes a row collinearity test
              and 1 invokes a column collinearity test.
     * @return A bool indicating whether or not the given cells are collinear in the given
          dimension.
     */
    collinear: function(cell1, cell2, column_test) {

      for(var i = 0; i < Math.min(cell1.length, cell2.length); i++) {
        var l1 = this._subdiv_xy(cell1.charAt(i));
        var x1 = l1[0];
        var y1 = l1[1];
        var l2 = this._subdiv_xy(cell2.charAt(i));
        var x2 = l2[0];
        var y2 = l2[1];

        // Check row collinearity (assure y's are always the same).
        if (!column_test && y1 != y2) {
          return false;
        }

        // Check column collinearity (assure x's are always the same).
        if(column_test && x1 != x2) {
          return false;
        }
      }   
      return true;
    },

    /**
     * 
     *    Calculates the grid of cells formed between the two given cells.

      Generates the set of cells in the grid created by interpolating from the
      given Northeast geocell to the given Southwest geocell.

      Assumes the Northeast geocell is actually Northeast of Southwest geocell.

     * 
     * @param cell_ne: The Northeast geocell string.
     * @param cell_sw: The Southwest geocell string.
     * @return A list of geocell strings in the interpolation.
     */
    interpolate: function(cell_ne, cell_sw) {
      // 2D array, will later be flattened.
      var cell_set = [];
      var cell_first = [];
      cell_first.push(cell_sw);
      cell_set.push(cell_first);

      // First get adjacent geocells across until Southeast--collinearity with
      // Northeast in vertical direction (0) means we're at Southeast.
      while(!this.collinear(arrayGetLast(cell_first), cell_ne, true)) {
        var cell_tmp = this.adjacent(arrayGetLast(cell_first), EAST);
        if(cell_tmp == null) {
          break;
        }
        cell_first.push(cell_tmp);
      }

      // Then get adjacent geocells upwards.
      while(!arrayGetLast(arrayGetLast(cell_set)).equalsIgnoreCase(cell_ne)) {

        var cell_tmp_row = [];
        var cell_set_last = arrayGetLast(cell_set);
        for(var i = 0; i < cell_set_last.length; i++) {
          cell_tmp_row.push(this.adjacent(cell_set_last[i], NORTH));
        }
        if( !arrayGetFirst(cell_tmp_row) ) {
          break;
        }
        cell_set.push(cell_tmp_row);
      }

      // Flatten cell_set, since it's currently a 2D array.
      var result = [];
      for(var i = 0; i < cell_set.length; i++) {
        arrayAddAll(result, cell_set[i]);
      }
      return result;
    },


    /**
     * Computes the number of cells in the grid formed between two given cells.

      Computes the number of cells in the grid created by interpolating from the
      given Northeast geocell to the given Southwest geocell. Assumes the Northeast
      geocell is actually Northeast of Southwest geocell.

     * @param cell_ne: The Northeast geocell string.
     * @param cell_sw: The Southwest geocell string.
     * @return An int, indicating the number of geocells in the interpolation.
     */
    interpolation_count: function(cell_ne, cell_sw) {

      var bbox_ne = this.compute_box(cell_ne);
      var bbox_sw = this.compute_box(cell_sw);

      var cell_lat_span = bbox_sw.getNorth() - bbox_sw.getSouth();
      var cell_lon_span = bbox_sw.getEast() - bbox_sw.getWest();

      var num_cols = Math.floor((bbox_ne.getEast() - bbox_sw.getWest()) / cell_lon_span);
      var num_rows = Math.floor((bbox_ne.getNorth() - bbox_sw.getSouth()) / cell_lat_span);

      return num_cols * num_rows;
    },

    /**
     * 
     * Calculates all of the given geocell's adjacent geocells.    
     * 
     * @param cell: The geocell string for which to calculate adjacent/neighboring cells.
     * @return A list of 8 geocell strings and/or None values indicating adjacent cells.
     */    

    all_adjacents: function(cell) {
      var result = [];
      var directions = [NORTHWEST, NORTH, NORTHEAST, EAST, SOUTHEAST, SOUTH, SOUTHWEST, WEST];
      for(var i = 0; i < directions.length; i++) {
        result.push(this.adjacent(cell, directions[i]));
      }
      return result;
    },

    /**
     * Calculates the geocell adjacent to the given cell in the given direction.
     * 
     * @param cell: The geocell string whose neighbor is being calculated.
     * @param dir: An (x, y) tuple indicating direction, where x and y can be -1, 0, or 1.
            -1 corresponds to West for x and South for y, and
             1 corresponds to East for x and North for y.
            Available helper constants are NORTH, EAST, SOUTH, WEST,
            NORTHEAST, NORTHWEST, SOUTHEAST, and SOUTHWEST.
     * @return The geocell adjacent to the given cell in the given direction, or null if
        there is no such cell.

     */
    adjacent: function(cell, dir) {
      if(!cell) {
        return null;
      }
      var dx = dir[0];
      var dy = dir[1];
      var cell_adj_arr = cell.split(""); // Split the geocell string characters into a list.
      var i = cell_adj_arr.length - 1;

      while(i >= 0 && (dx != 0 || dy != 0)) {
        var l= this._subdiv_xy(cell_adj_arr[i]);
        var x = l[0];
        var y = l[1];

        // Horizontal adjacency.
        if(dx == -1) {  // Asking for left.
          if(x == 0) {  // At left of parent cell.
            x = GEOCELL_GRID_SIZE - 1;  // Becomes right edge of adjacent parent.
          } else {
            x--;  // Adjacent, same parent.
            dx = 0; // Done with x.
          }
        }
        else if(dx == 1) { // Asking for right.
          if(x == GEOCELL_GRID_SIZE - 1) { // At right of parent cell.
            x = 0;  // Becomes left edge of adjacent parent.
          } else {
            x++;  // Adjacent, same parent.
            dx = 0;  // Done with x.
          }
        }

        // Vertical adjacency.
        if(dy == 1) { // Asking for above.
          if(y == GEOCELL_GRID_SIZE - 1) {  // At top of parent cell.
            y = 0;  // Becomes bottom edge of adjacent parent.
          } else {
            y++;  // Adjacent, same parent.
            dy = 0;  // Done with y.
          }
        } else if(dy == -1) {  // Asking for below.
          if(y == 0) { // At bottom of parent cell.
            y = GEOCELL_GRID_SIZE - 1; // Becomes top edge of adjacent parent.
          } else {
            y--;  // Adjacent, same parent.
            dy = 0;  // Done with y.
          }
        }

        var l2 = [x,y];
        cell_adj_arr[i] = this._subdiv_char(l2);
        i--;
      }
      // If we're not done with y then it's trying to wrap vertically,
      // which is a failure.
      if(dy != 0) {
        return null;
      }

      // At this point, horizontal wrapping is done inherently.
      return cell_adj_arr.join("");
    },

    /**
     * Returns whether or not the given cell contains the given point.
     * 
     * @param cell
     * @param point
     * @return Returns whether or not the given cell contains the given point.
     */
    contains_point: function(cell, point) {
      return this.compute(point, cell.length).equalsIgnoreCase(cell);
    },

    /**
     *     Returns the shortest distance between a point and a geocell bounding box.

      If the point is inside the cell, the shortest distance is always to a 'edge'
      of the cell rectangle. If the point is outside the cell, the shortest distance
      will be to either a 'edge' or 'corner' of the cell rectangle.
     * 
     * @param cell
     * @param point
     * @return The shortest distance from the point to the geocell's rectangle, in meters.
     */
    point_distance: function(cell, point) {
      var bbox = this.compute_box(cell);

      var between_w_e = bbox.getWest() <= point.lon && point.lon <= bbox.getEast();
      var between_n_s = bbox.getSouth() <= point.lat && point.lat <= bbox.getNorth();

      if(between_w_e) {
        if(between_n_s) {
          // Inside the geocell.
          return Math.min(
              Math.min(distance(point, this.create_point(bbox.getSouth(), point.lon)),distance(point, this.create_point(bbox.getNorth(), point.lon))),
              Math.min(distance(point, this.create_point(point.lat, bbox.getEast())),distance(point, this.create_point(point.lat, bbox.getWest()))));
        } else {
          return Math.min(distance(point, this.create_point(bbox.getSouth(), point.lon)),distance(point, this.create_point(bbox.getNorth(), point.lon))); 
        } 
      } else {
        if(between_n_s) {
          return Math.min(distance(point, this.create_point(point.lat, bbox.getEast())),distance(point, this.create_point(point.lat, bbox.getWest())));
        } else {
          // TODO(romannurik): optimize
          return Math.min(Math.min(distance(point, this.create_point(bbox.getSouth(), bbox.getEast())),distance(point, this.create_point(bbox.getNorth(), bbox.getEast()))),
              Math.min(distance(point, this.create_point(bbox.getSouth(), bbox.getWest())),distance(point, this.create_point(bbox.getNorth(), bbox.getWest()))));
        }
      }
    },

    /**
     * Computes the geocell containing the given point to the given resolution.

      This is a simple 16-tree lookup to an arbitrary depth (resolution).
     * 
     * @param point: The geotypes.Point to compute the cell for.
     * @param resolution: An int indicating the resolution of the cell to compute.
     * @return The geocell string containing the given point, of length resolution.
     */
    compute: function(point, resolution) {
 
      resolution = resolution || MAX_GEOCELL_RESOLUTION

      var north = 90.0;
      var south = -90.0;
      var east = 180.0;
      var west = -180.0;

      var cell = "";
      while(cell.length < resolution) {
        var subcell_lon_span = (east - west) / GEOCELL_GRID_SIZE;
        var subcell_lat_span = (north - south) / GEOCELL_GRID_SIZE;

        var x = Math.min(Math.floor(GEOCELL_GRID_SIZE * (point.lon - west) / (east - west)),
                         GEOCELL_GRID_SIZE - 1);
        var y = Math.min(Math.floor(GEOCELL_GRID_SIZE * (point.lat - south) / (north - south)),
                         GEOCELL_GRID_SIZE - 1);

        var l = [x,y];
        cell += this._subdiv_char(l);

        south += subcell_lat_span * y;
        north = south + subcell_lat_span;

        west += subcell_lon_span * x;
        east = west + subcell_lon_span;
      }
      return cell;
    },

    /**
     * Computes the rectangular boundaries (bounding box) of the given geocell.
     * 
     * @param cell_: The geocell string whose boundaries are to be computed.
     * @return A geotypes.Box corresponding to the rectangular boundaries of the geocell.
     */
    compute_box: function(cell_) {
      if(!cell_) {
        return null;
      }

      var bbox = this.create_bounding_box(90.0, 180.0, -90.0, -180.0);
      var cell = cell_;
      while(cell.length > 0) {
        var subcell_lon_span = (bbox.getEast() - bbox.getWest()) / GEOCELL_GRID_SIZE;
        var subcell_lat_span = (bbox.getNorth() - bbox.getSouth()) / GEOCELL_GRID_SIZE;

        var l = this._subdiv_xy(cell.charAt(0));
        var x = l[0];
        var y = l[1];

        bbox = this.create_bounding_box(bbox.getSouth() + subcell_lat_span * (y + 1),
            bbox.getWest()  + subcell_lon_span * (x + 1),
            bbox.getSouth() + subcell_lat_span * y,
            bbox.getWest()  + subcell_lon_span * x);

        cell = cell.substring(1);
      }

      return bbox;
    },

    /**
     * Returns whether or not the given geocell string defines a valid geocell.
     * @param cell
     * @return Returns whether or not the given geocell string defines a valid geocell.
     */
    is_valid: function(cell) {
      if(!cell) {
        return false;
      }
      for(var i = 0; i < cell.length; i++) {
        if(GEOCELL_ALPHABET.indexOf(cell.charAt(i)) < 0) {
          return false;
        }
      }
      return true;
    },

    /**
     * Returns the (x, y) of the geocell character in the 4x4 alphabet grid.
     * @param char_
     * @return Returns the (x, y) of the geocell character in the 4x4 alphabet grid.
     */
    _subdiv_xy:function(char_) {
      // NOTE: This only works for grid size 4.
      var charI = GEOCELL_ALPHABET.indexOf(char_);
      return [(charI & 4) >> 1 | (charI & 1) >> 0,
                (charI & 8) >> 2 | (charI & 2) >> 1];
    },

    /**
     * Returns the geocell character in the 4x4 alphabet grid at pos. (x, y).
     * @param pos
     * @return Returns the geocell character in the 4x4 alphabet grid at pos. (x, y).
     */
    _subdiv_char: function(pos) {
      // NOTE: This only works for grid size 4.
      return GEOCELL_ALPHABET.charAt(
                                (pos[1] & 2) << 2 |
                                (pos[0] & 2) << 1 |
                                (pos[1] & 1) << 1 |
                                (pos[0] & 1) << 0);
    },

    /**
     * Calculates the great circle distance between two points (law of cosines).
     * 
     * @param p1: A geotypes.Point or db.GeoPt indicating the first point.
     * @param p2: A geotypes.Point or db.GeoPt indicating the second point.
     * @return The 2D great-circle distance between the two given points, in meters.
     */
    distance: function(p1, p2) {
        var p1lat = Math.toRadians(p1.lat);
        var p1lon = Math.toRadians(p1.lon);
        var p2lat = Math.toRadians(p2.lat);
        var p2lon = Math.toRadians(p2.lon);
        return RADIUS * Math.acos(Math.sin(p1lat) * Math.sin(p2lat) +
               Math.cos(p1lat) * Math.cos(p2lat) * Math.cos(p2lon - p1lon));
    },

    /** Returns the edges of the rectangular region containing all of the
      * given geocells, sorted by distance from the given point, along with
      * the actual distances from the point to these edges.
      */
    distance_sorted_edges: function(cells, point) {

      // TODO(romannurik): Assert that lat,lon are actually inside the geocell.
      var that = this
      if (logger.isDebugEnabled()) logger.debug('cells: ' + inspect(cells))
      var boxes = _.map(cells, function(cell) { return that.compute_box(cell) })

      var max_box = this.create_bounding_box(
                      Math.max.apply(null, _.map(boxes, function(box) { return box.getNorth() })),
                      Math.max.apply(null, _.map(boxes, function(box) { return box.getEast() })),
                      Math.max.apply(null, _.map(boxes, function(box) { return box.getSouth() })),
                      Math.max.apply(null, _.map(boxes, function(box) { return box.getWest() })))
      return _.zip.apply(_, 
        [
          [[0,-1], that.distance(this.create_point(max_box.getSouth(), point.lon), point)],
          [[0,1],  that.distance(this.create_point(max_box.getNorth(), point.lon), point)],
          [[-1,0], that.distance(this.create_point(point.lat, max_box.getWest()), point)],
          [[1,0],  that.distance(this.create_point(point.lat, max_box.getEast()), point)]
        ].sort(function(x, y) { return cmp(x[1], y[1]) }) )
    },

    /** Given a point and a distance in miles, creates a bounding box that
      * encompasses the desired area.
      */ 
    bounding_box_from_distance: function(pt, dist_mi) {
        var radDist = dist_mi / RADIUS_MI;

        var radLat = pt.lat;
        var radLon = pt.lon;

        radLat = Math.toRadians(radLat);
        radLon = Math.toRadians(radLon);

        var minLat = radLat - radDist;
        var maxLat = radLat + radDist;

        minLon = 0.0;
        maxLon = 0.0;
        if(minLat > MIN_LAT && maxLat < MAX_LAT) {
            deltaLon = Math.asin(Math.sin(radDist) / Math.cos(radLat));
            minLon = radLon - deltaLon;
            if(minLon < MIN_LON)
                minLon = minLon + (2 * Math.PI);
            maxLon = radLon + deltaLon;
            if(maxLon > MAX_LON)
                maxLon = maxLon - (2 * Math.PI);
        }
        else {
            //a pole is within the distance
            minLat = Math.max(minLat, MIN_LAT);
            maxLat = Math.min(maxLat, MAX_LAT);
            minLon = MIN_LON;
            maxLon = MAX_LON;
        }
        return this.create_bounding_box(Math.toDegrees(maxLat), Math.toDegrees(maxLon), 
                        Math.toDegrees(minLat), Math.toDegrees(minLon));
    },

    /** Performs a bounding box fetch from a list of given entities. 
     *
     * Fetches at most <max_results> entities matching the given query, sorted by
     * distance to a center point, if given.
     *
     * This method attempts to find an efficient set of geocells to search within
     * to pair down the number of entities to check, then slims that list down to 
     * only the entities within the given bounding box.
     *
     * Args:
     *   entities: A list of entities to search within. These must be objects with
     *       and 'id' property and a 'location' property that is a Geomodel point.
     *   bbox: A bounding box returned from Geomodel.create_bounding_box.
     *   center: The point object representing the center of the bounding box (or
     *       just the point you wish to get the nearest entities to).
     *   max_results: An int indicating the maximum number of desired results.
     *       The default is 10.
     *   cost_function: A function that accepts two arguments:
     *          * num_cells: the number of cells to search
     *          * resolution: the resolution of each cell to search
     *       and returns the 'cost' of querying against this number of cells
     *       at the given resolution.
     *   event_listeners: A hash of functions to handle success and error 
     *       results from this method.  The proximity results will be passed to
     *       the success function.
     * 
     * On success, calls event_listeners.success.
     * On error, calls event_listeners.error.
     *
     */
    bounding_box_fetch: function(entities, bbox, center, max_results, cost_function, 
                                    event_listeners) {
        max_results = max_results || 10;
        cost_function = cost_function || this.default_cost_function;
        query_geocells = this.best_bbox_search_cells(bbox, cost_function);
        var selected = _.select(entities, function(o){
                return (_.intersection(o.geocells, query_geocells))
            }
        );
        var results = [];
        var myself = this;
        if(selected) {
            results = _.select(selected, function(o){
                return o.location.lat >= bbox.getSouth() &&
                o.location.lat <= bbox.getNorth() &&
                o.location.lon >= bbox.getWest() &&
                o.location.lon <= bbox.getEast()
            });
            if(center) {
                _.map(results, function(o) {
                    o.distance_from_center = myself.distance(center, o.location);
                });
                var sorted_results = _.sortBy(results, function(o) {
                    return o.distance_from_center;
                });
                return event_listeners.success(sorted_results.slice(0, max_results));
            }
        }
        event_listeners.success(results.slice(0, max_results));
    },


    /** Performs a proximity/radius fetch using the given entity finder. 
     *
     * Fetches at most <max_results> entities matching the given query,
     * ordered by ascending distance from the given center point, and optionally
     * limited by the given maximum distance.
     *
     * This method uses a greedy algorithm that starts by searching high-resolution
     * geocells near the center point and gradually looking in lower and lower
     * resolution cells until max_results entities have been found matching the
     * given query and no closer possible entities can be found.
     * 
     * Args:
     *   center: A point indicating the center point around which to search for
     *       matching entities.  A point is just an object with a 'lat' and 'lon'
     *       property.
     *   max_results: An int indicating the maximum number of desired results.
     *       The default is 10, and the larger this number, the longer the fetch
     *       will take.
     *   max_distance: An optional number indicating the maximum distance to
     *       search, in meters.
     *   entity_finder: A function which takes a list of geocells as the first
     *       parameter and finds all of the objects in those cells.  Objects
     *       should have a 'id' and 'location' property.  The second argument
     *       passed to this function will a callback function to handle finder
     *       results.  An error object should be passed as the first argument
     *       to the callback, if one occurs, otherwise the first argument should
     *       be null.  The finder results should be passed to the callback as
     *       the second argument.  
     *   callback: A functions to handle the results from this method.  An error
     *       object will be passed as the first argument to this function, if one 
     *       occurs, otherwise the first argument will be null.  The proximity 
     *       results will be passed to this function as the second argument.
     * 
     * Returns:
     *   The fetched entities, sorted in ascending order by distance to the search
     *   center.
     * 
     */
    proximity_fetch: function(center, max_results, max_distance, entity_finder, callback) {
      max_results = max_results || 10
      max_distance = max_distance || 0
      var that = this

      var results = []
      var searched_cells = []

      // The current search geocell containing the lat,lon.
      var cur_containing_geocell = this.compute(center)

      // The currently-being-searched geocells.
      // NOTES:
      //     * Start with max possible.
      //     * Must always be of the same resolution.
      //     * Must always form a rectangular region.
      //     * One of these must be equal to the cur_containing_geocell.
      var cur_geocells = [cur_containing_geocell]

      var closest_possible_next_result_dist = 0

      // Assumes both a and b are lists of (entity, dist) tuples, *sorted by dist*.
      // NOTE: This is an in-place merge, and there are guaranteed
      // no duplicates in the resulting list.
      function _merge_results_in_place(a, b) {
        merge_in_place([a, b],
          function(x, y) { return cmp(x[1], y[1]) },
          function(x, y) { 
            if (x[0].id) {
              return (x[0].id == y[0].id);
            } else if (x[0].get_id) {
              return (x[0].get_id() == y[0].get_id());               
            } else {
              throw Error("Entities do not have an id property.");
            }
          })
      }

      var sorted_edges = [[0,0]]
      var sorted_edge_distances = [0]
      
      fetch_more();
      
      function fetch_more() {      
        
        if (cur_geocells.length < 1) { done(); return;}
        closest_possible_next_result_dist = sorted_edge_distances[0]
        if (logger.isDebugEnabled()) {
          logger.debug('closest_possible_next_result_dist: ' + 
                        inspect(closest_possible_next_result_dist))
        }
        if (max_distance && closest_possible_next_result_dist > max_distance) {
          done();
          return;
        }

        var cur_geocells_unique = _.reject(_.uniq(cur_geocells), function(cell) { 
                                    return _.include(searched_cells, cell) 
                                  })
        if (logger.isDebugEnabled()) logger.debug('cur_geocells: ' + inspect(cur_geocells))
        if (logger.isDebugEnabled()) logger.debug('cur_geocells_unique: ' + inspect(cur_geocells_unique))
        // Run query on the next set of geocells.
        var cur_resolution = cur_geocells[0].length
        // Update results
        
        var new_results;
        entity_finder(cur_geocells_unique, function(err, results) {
          if (err) {
            var error_mess = "Got error from entity finder: " + err;
            callback(new Error(error_mess));
          } else {
            new_results = results;
            process_new_results();
          }
        });

        function process_new_results() {
          if (logger.isDebugEnabled()) logger.debug('fetch complete for ' + inspect(cur_geocells_unique))

          searched_cells = _.uniq(searched_cells.concat(cur_geocells))

          // Begin Storing distance from the search result entity to the
          // search center along with the search result itself, in a tuple.
          new_results = _.map(new_results, function(entity) { 
                              return [entity, that.distance(center, entity.location)]
                        })
          new_results.sort(function(dr1, dr2) { return cmp(dr1[1], dr2[1]) })
          new_results = _.first(new_results, max_results)
          if (logger.isDebugEnabled()) logger.debug('new results:' + inspect(new_results))
          // Merge new_results into results or the other way around, depending on
          // which is larger.
          if (results.length > new_results.length)
            _merge_results_in_place(results, new_results)
          else {
            _merge_results_in_place(new_results, results)
            results = new_results
          }
          if (logger.isDebugEnabled()) logger.debug('results(after merge):' + inspect(results))
          results = _.first(results, max_results)

          var sorted = that.distance_sorted_edges(cur_geocells, center)
          if (logger.isDebugEnabled()) logger.debug('sorted: ' + inspect(sorted))
          sorted_edges = sorted[0]  
          sorted_edge_distances = sorted[1]
          var nearest_edge, perpendicular_nearest_edge

          if (results.length == 0 || cur_geocells.length == 4) {
            // Either no results (in which case we optimize by not looking at
            // adjacents, go straight to the parent) or we've searched 4 adjacent
            // geocells, in which case we should now search the parents of those
            // geocells.
            cur_containing_geocell = cur_containing_geocell.substring(0, cur_containing_geocell.length-1)
            cur_geocells = _.uniq(_.map(cur_geocells, function(cell) {
                                     return cell.substring(0, cell.length-1) 
                                  }))
            if (cur_geocells.length < 1 || ! cur_geocells[0]) {
              done();  // Done with search, we've searched everywhere.
              return;
            }

          } else if (cur_geocells.length == 1) {
            // Get adjacent in one direction.
            // TODO(romannurik): Watch for +/- 90 degree latitude edge case geocells.
            nearest_edge = sorted_edges[0]
            if (logger.isDebugEnabled()) logger.debug('nearest edge:' + inspect(nearest_edge))
            if (logger.isDebugEnabled()) logger.debug('adjacent cell:' + inspect(that.adjacent(cur_geocells[0], nearest_edge)))
            cur_geocells.push(that.adjacent(cur_geocells[0], nearest_edge))

          } else if (cur_geocells.length == 2) {
            // Get adjacents in perpendicular direction.
            nearest_edge = that.distance_sorted_edges([cur_containing_geocell],
                                                        center)[0][0]
            if (logger.isDebugEnabled()) logger.debug('sorted edges:' + inspect(sorted_edges))
            if (logger.isDebugEnabled()) logger.debug('nearest edge:' + inspect(nearest_edge))
            if (nearest_edge[0] == 0) {
              // Was vertical, perpendicular is horizontal.
              perpendicular_nearest_edge = _.reject(sorted_edges, function(x) {
                                              return (x[0] == 0)
                                           })[0]
            } else {
              // Was horizontal, perpendicular is vertical.
              perpendicular_nearest_edge = _.reject(sorted_edges, function(x) { 
                                              return (x[0] != 0)
                                           })[0]
            }
            if (logger.isDebugEnabled()) logger.debug('perpendicular nearest edge:' + inspect(perpendicular_nearest_edge))
            if (logger.isDebugEnabled()) logger.debug('adjacent cell:' + inspect(that.adjacent(cur_geocells[0], perpendicular_nearest_edge)))
            cur_geocells = cur_geocells.concat(_.map(cur_geocells, function(cell) {
                              return that.adjacent(cell, perpendicular_nearest_edge) 
                           }))
            cur_geocells = _.reject(cur_geocells, function(cell) { return !cell })
          }

          // We don't have enough items yet, keep searching.
          if (results.length < max_results) {
            if (logger.isDebugEnabled()) {
              logger.debug('have ' + results.length + ' results but want ' + 
                            max_results + ' results, continuing search')
            }
            fetch_more();
            return;
          }

          if (logger.isDebugEnabled()) logger.debug('have ' + results.length + ' results')

          // If the currently max_results'th closest item is closer than any
          // of the next test geocells, we're done searching.
          current_farthest_returnable_result_dist = that.distance(center, 
                                                      results[max_results - 1][0].location)
          if (closest_possible_next_result_dist >=
              current_farthest_returnable_result_dist) {
            if (logger.isDebugEnabled()) {
              logger.debug('DONE next result at least ' + 
                            closest_possible_next_result_dist +
                            ' away, current farthest is ' + 
                            current_farthest_returnable_result_dist + ' dist')
            }
            done();
            return;
          }

          if (logger.isDebugEnabled()) {
            logger.debug('next result at least ' + 
                          closest_possible_next_result_dist + 
                          ' away, current farthest is ' +
                          current_farthest_returnable_result_dist + ' dist')
          }
          
          fetch_more();
        }
      }

      function done() {
        if (logger.isDebugEnabled()) logger.debug('proximity query looked in ' + searched_cells.length + ' geocells')
        var final_results = _.reject(results.slice(0, max_results), function(result) {
          return max_distance &&  result[1] >  max_distance
        })
        callback(null, final_results);
      }
    }

  }
}
