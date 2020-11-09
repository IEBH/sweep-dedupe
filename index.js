var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var natural = require('natural');


/**
* Dedupe class
*/
module.exports = class Dedupe extends EventEmitter {

	/**
	* Instance settings
	* Can be set using the utility funciton `set(key, val)`
	* @type {Object} The settings to use in this Dedupe instance
	* @property {string} stratergy The stratergy to use on the next `run()` call
	*/
	settings = {
		strategy: 'clark',
	};


	// Comparisons {{{
	/**
	* Lookup for all supported comparison methods
	* @type {Object<Object>} Lookup object of comparison methods
	* @property {string} title The short human-readable title of the comparison
	* @property {string} description A longer HTML compatible description of the comparison
	* @property {function} handler A function, called as `(a, b)` which is expected to return a floating value of the input similarity
	*/
	comparisons = {
		exact: {
			title: 'Exact comparison',
			description: 'Simple character-by-character exact comaprison',
			handler: (a, b) => a == b ? 1 : 0,
		},
		jaroWinkler: {
			title: 'Jaro-Winkler',
			description: 'String distance / difference calculator using the [Jaro-Winkler metric](https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance)',
			handler: (a, b) => natural.JaroWinklerDistance(a, b, false),
		},
	};
	// }}}

	// Mutators {{{
	/**
	* Lookup for all supported mutator methods
	* @type {Object<Object>} Lookup object of mutator methods
	* @property {string} title The short human-readable title of the mutator
	* @property {string} description A longer HTML compatible description of the mutator
	* @property {function} handler A function, called as `(v)` which is expected to return a mutated version of the input
	*/
	mutators = {
		alphaNumericOnly: {
			title: 'Alpha-Numeric only',
			description: 'Remove all punctuation except characters and numbers',
			handler: v => v.replace(/[^0-9a-z\s]+/g, ' '),
		},
		authorRewrite: {
			title: 'Rewrite author names',
			description: 'Clean up various author specifications into one standard format',
			handler: v => v, // FIXME: Needs work
		},
		deburr: {
			title: 'Deburr',
			description: 'Convert all <a href="https://en.wikipedia.org/wiki/Latin-1_Supplement_(Unicode_block)#Character_table">latin-1 supplementary letters</a> to basic latin letters and also remove <a href="https://en.wikipedia.org/wiki/Combining_Diacritical_Marks">combining diacritical marks</a>. e.g. <code>ÕÑÎÔÑ</code> becomes <code>ONION</code>',
			handler: v => _.deburr(v),
		},
		disguardCase: {
			title: 'Case insenstive',
			description: 'Convert all upper-case alpha characters to lower case',
			handler: v => v.toLowerCase(),
		},
		doiRewrite: {
			title: 'Rewrite DOIs',
			description: 'Attempt to tidy up mangled DOI fields from partial DOIs to full URLs',
			handler(v, ref) {
				if (v) {
					return /^https:\/\//.test(v) ? v // Already ok
					: /^http:\/\//.test(v) ? v.replace(/^http:/, 'https:') // using HTTP instead of HTTPS
					: 'https://doi.org/' + v;
				} else { // Look in ref.urls to try and find a misfiled DOI
					var foundDoi = ref.urls.find(u => /^https:\/\/doi.org\//.test(u)); // Find first DOI looking URL
					if (foundDoi) return foundDoi;
					return ''; // Give up and return an empty string
				}
			},
		},
		numericOnly: {
			title: 'Numeric only',
			description: 'Remove all non-numeric characters',
			handler: v => v.replace(/[^0-9]+/g, ''),
		},
		removeEnclosingBrackets: {
			title: 'Remove enclosing brackets',
			description: 'Remove all wrapping brackets or other parenthesis, useful for translated titles',
			handler: v => _.trim(v, '()[]{}'),
		},
	};
	// }}}

	// Strategies {{{
	strategies = {
		clark: require('./strategies/clark'),
		doiOnly: require('./strategies/doiOnly'),
	};
	// }}}


	/**
	* Class constructor
	* @param {Object} [options] Initial options to populate
	*/
	constructor(options) {
		super();
		this.set(options);
	}


	/**
	* Set class options either via an object merge or key val setter
	* @param {Object|string} option Either a full object to merge or the key of the setting to set
	* @param {*} [value] If `option` is a string, specify the new value
	* @returns {Dedupe} This chainable instance
	*/
	set(option, value) {
		if (_.isPlainObject(option)) {
			Object.assign(this.settings, option);
		} else {
			this.settings[option] = value;
		}
		return this;
	}


	/**
	* Run the deduplication process
	* @param {array|string} input Either an existing parsed collection of references or a path to parse
	* @returns {Promise<array>} The output collection with an additional field `dedupe` which is a floating value between 0 - 1
	*
	* @emits runMutated Emitted when the fully mutated library is ready to start deduplicating
	*/
	run(input) {
		return Promise.resolve()
			.then(()=> {
				// Parse inputs if they look like paths, otherwise assume they are given as arrays
				return _.isString(input) ? reflib.promises.parseFile(input) : input;
			})
			// Sanity checks {{{
			.then(input => {
				if (!_.isArray(input)) throw new Error('Input is not an array');
				if (!_.has(this, ['strategies', this.settings.strategy])) throw new Error('Unknown stratergy specified');
				if (!_.isArray(_.get(this, ['strategies', this.settings.strategy, 'steps']))) throw new Error('Invalid stratergy schema');
				return input;
			})
			// }}}
			.then(input => {
				var stratergy = this.strategies[this.settings.strategy];
				return input.map(ref => ({
					...ref, // Import original reference
					..._.mapValues(stratergy.mutators, (mutators, field) =>
						_.castArray(mutators).reduce((value, mutator) =>
							this.mutators[mutator].handler(value, ref)
						, ref[field] || '')
					),
				}));
			})
			.then(input => {
				this.emit('runMutated', input);
				// FIXME:
			})
	};
}
