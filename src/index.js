import _ from "lodash"
import { EventEmitter } from "events";
import jaroWinklerDistance from 'jaro-winkler'

import clark from './strategies/clark.js';
import bramer from './strategies/bramer.js';
import forbes from './strategies/forbes.js';
import forbesMinFN from './strategies/forbesMinFN.js';
import forbesMinFP from './strategies/forbesMinFP.js';
import doiOnly from './strategies/doiOnly.js';

/**
* Dedupe class
*/
export default class Dedupe extends EventEmitter {

	/**
	* Instance settings
	* Can be set using the utility function `set(key, val)`
	* @type {Object} The settings to use in this Dedupe instance
	* @property {string} strategy The strategy to use on the next `run()` call
	* @property {boolean} validateStrategy Validate the strategy before beginning, only disable this if you are sure the strategy is valid
	* @property {string} action The action to take when detecting a duplicate. ENUM: ACTIONS
	* @property {string} actionField The field to use with actions
	* @property {number} threshold Floating value (between 0 and 1) when marking or deleting refs automatically
	* @property {string|function} markOk String value to set the action field to when `actionField=='mark'` and the ref is a non-dupe, if a function it is called as `(ref)`
	* @property {string|function} markDupe String value to set the action field to when `actionField=='mark'` and the ref is a dupe, if a function it is called as `(ref)`
	* @property {string} dupeRef How to refer to other refs when `actionfield=='stats'`. ENUM: DUPEREF
	* @property {string} fieldWeight Whether to use the minimum score between fields or the average when deciding if dupe
	* @property {string} markOriginal Whether mark the original duplicate as a dupe or not
	*/
	settings = {
		strategy: 'clark',
		validateStrategy: true,
		action: 0,
		actionField: 'dedupe',
		threshold: 0.1,
		markOk: 'OK',
		markDupe: 'DUPE',
		dupeRef: 0,
		fieldWeight: 0,
		markOriginal: false,
	};



	/**
	* Available actions for duplicates
	*/
	static ACTIONS = {
		STATS: 0,
		MARK: 1,
		DELETE: 2,
	};


	/**
	* Available methods to set the `dupeRef` - which appears as `dupeOf` when `actionfield=='stats'`
	*/
	static DUPEREF = {
		INDEX: 0,
		RECNUMBER: 1,
	};


	/**
	 * Avaliable field weighting systems to use
	 */
	static FIELDWEIGHT = {
		MINIMUM: 0,
		AVERAGE: 1
	}


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
			description: 'Simple character-by-character exact comparison',
			handler: (a, b) => {
				if (Array.isArray(a) && Array.isArray(b)) {
					return JSON.stringify(a) == JSON.stringify(b);
				}
				return a == b ? 1 : 0
			},
		},
		exactTruncate: {
			title: 'Exact comparison with truncate',
			description: 'Exact comparison but truncate strings to the shortest',
			handler: (a, b) => a.substr(0, Math.min(a.length, b.length)) == b.substr(0, Math.min(a.length, b.length)) ? 1 : 0,
		},
		jaroWinkler: {
			title: 'Jaro-Winkler',
			description: 'String distance / difference calculator using the [Jaro-Winkler metric](https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance)',
			handler: (a, b) => jaroWinklerDistance(a, b),
		},
		random: {
			title: 'Random',
			description: 'Ignore comparisons and pick a number between 0 and 1',
			handler: (a, b) => _.random(0, 1, true),
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
			handler: v => v.replace(/[^0-9A-Za-z\s]+/g, ' '),
		},
		noSpace: {
			title: 'Remove whitespace',
			description: 'Remove all whitespace e.g " "',
			handler: v => v.replace(/[\s]+/g, ''),
		},
		authorRewrite: {
			title: 'Rewrite author names',
			description: 'Clean up various author specifications into one standard format',
			handler: v => {
				if (/;/.test(v)) { // Detect semi colon separators to search `Last, F. M.` format
					return _.chain(v)
						.split(/\s*;\s*/)
						.dropRightWhile(name => /^et\.?\s*al/i.test(name)) // Looks like "Et. Al" from end
						.map(name => {
							var format = /^(?<last>[A-Z][a-z]+),?\s+(?<first>[A-Z])/.exec(name);
							return format ?
								format.groups.first.substr(0, 1).toUpperCase() + '. '
								+ _.upperFirst(format.groups.last)
							: name;
						})
						.join(', ')
						.value()
				} else {
					return _.chain(v)
						.split(/\s*,\s*/) // Split into names
						.dropRightWhile(name => /^et\.?\s*al/i.test(name)) // Looks like "Et. Al" from end
						.map(name => { // Reparse all names
							var format = [
								/^(?<first>[A-Z][a-z]+)\s+(?<last>[A-Z][a-z]+)$/, //~= First Last
								/^(?<first>[A-Z])\.?\s+(?<middle>.*?)\s*(?<last>[A-Z][a-z]+)$/, //~= F. Last
								/^(?<first>[A-Z][a-z]+?)\s+(?<middle>.*?)\s*(?<last>[A-Z][a-z]+)$/, //~= First Middle Last
								/^(?<last>[A-Z][a-z]+)\s+(?<middle>.*?)\s*(?<first>[A-Z]\.?)/, //~= Last F.
							].reduce((matchingFormat, re) =>
								matchingFormat // Already found a match
								|| re.exec(name) // Attempt to match this element
							, false);

							return format ?
								format.groups.first.substr(0, 1).toUpperCase() + '. '
								+ _.upperFirst(format.groups.last)
							: name;
						})
						.join(', ') // Join as comma-delimited strings
						.value();
				}
			},
		},
		authorRewriteSingle: {
			title: 'Rewrite singular author name',
			description: 'Clean up various author specifications into one standard format',
			handler: v => {
				const name = v
				var format = [
					/^(?<last>[A-Za-z\s]+),+\s+(?<first>[A-Z])/, // Last, F. M.
					/^(?<first>[A-Z][a-z]+)\s+(?<last>[A-Z][a-z]+)$/, //~= First Last
					/^(?<first>[A-Z])\.?\s+(?<middle>.*?)\s*(?<last>[A-Z][a-z]+)$/, //~= F. Last
					/^(?<first>[A-Z][a-z]+?)\s+(?<middle>.*?)\s*(?<last>[A-Z][a-z]+)$/, //~= First Middle Last
					/^(?<last>[A-Z][a-z]+)\s+(?<middle>.*?)\s*(?<first>[A-Z]\.?)/, //~= Last F.
				].reduce((matchingFormat, re) =>
					matchingFormat // Already found a match
					|| re.exec(name) // Attempt to match this element
				, false);

				return format ?
					format.groups.first.substr(0, 1).toUpperCase() + '. '
					+ _.upperFirst(format.groups.last)
				: name;
			},
		},
		deburr: {
			title: 'Deburr',
			description: 'Convert all <a href="https://en.wikipedia.org/wiki/Latin-1_Supplement_(Unicode_block)#Character_table">latin-1 supplementary letters</a> to basic latin letters and also remove <a href="https://en.wikipedia.org/wiki/Combining_Diacritical_Marks">combining diacritical marks</a>. e.g. <code>ÕÑÎÔÑ</code> becomes <code>ONION</code>',
			handler: v => _.deburr(v),
		},
		noCase: {
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
					var foundDoi = (ref.urls ?? []).find(u => /^https?:\/\/doi.org\//.test(u)); // Find first DOI looking URL
					if (foundDoi) return foundDoi.replace(/^http:/, 'https:');
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
		stripHtmlTags: {
			title: 'Remove html/xml tags from title',
			description: 'Remove html tag',
			handler: v => v.replace(/(<([^>]+)>)/ig, ""),
		},
		consistentPageNumbering: {
			title: 'Mutate PubMed page numbering into consistent format',
			description: 'E.g. 244-58 => 244-258',
			handler: v => {
				// Find page numbers
				let pages = /^(?<from>\d+)\s*(\p{Pd}+(?<to>\d+)\s*)?$/u.exec(v)?.groups;
				if (pages && pages.from && pages.to) {
					// Find the difference in length of the page number strings
					const offset = pages.from.length - pages.to.length;
					// Take the prefix that is missing from the 2nd page number
					const prefix = pages.from.substring(0, offset);
					// Prepend the prefix to the page number
					return `${ pages.from }-${ prefix + pages.to }`;
				} else if (pages && pages.from) {
					return pages.from;
				} else {
					return "";
				}
			}
		}
	};
	// }}}

	// Strategies {{{
	static strategies = {
		clark,
		bramer,
		forbes,
		forbesMinFN,
		forbesMinFP,
		doiOnly,
	};
	// }}}


	/**
	* Class constructor
	* @param {Object} [options] Initial options to populate
	*/
	constructor(options) {
		super();
		this.settings.action = Dedupe.ACTIONS.STATS;
		this.settings.dedupeRef = Dedupe.DUPEREF.INDEX;
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
	* Validate a strategy object
	* @param {object} strategy The strategy object to validate
	* @returns {boolean|array} Either a boolean True if the strategy is valid or an array of errors
	*/
	validateStrategy(strategy) {
		var errs = [];

		['title', 'description', 'mutators', 'steps'].forEach(f => {
			if (!strategy[f]) errs.push(`Field ${f} is missing`);
		});

		if (!strategy.steps.length) errs.push('Should contain at least one step');

		if (strategy.steps) strategy.steps.forEach((step, stepIndex) => {
			if (!step.fields || !step.fields.length) errs.push(`Step #${stepIndex+1} contains no fields`);
			if (!step.sort) errs.push(`Step #${stepIndex+1} contains no sort field(s)`);
			if (_.isArray(step.sort) && !step.sort.length) errs.push(`Step #${stepIndex+1} contains a blank sort field list`)
			if (!step.comparison) errs.push(`Step #${stepIndex+1} contains no comparison`);
		});

		return errs.length > 0 ? errs : true;
	};


	/**
	* Compare two references at against rules specified in a step
	* @param {Object} a The first reference to compare
	* @param {Object} b The second reference to compare
	* @param {Object} step The step object, specifying the rules for comparison
	* @returns {number} A floating value representing the average similarity between the two references for this steps rules
	*/
	compareViaStepAvg(a, b, step) {
		return step.fields.reduce((result, field) =>
			(step.skipOmitted ?? true ) && (!a[field] || !b[field])
				? 0
				: this.comparisons[step.comparison].handler(a[field], b[field])
		, 0) / step.fields.length;
	};

	/**
	* Compare two references at against rules specified in a step
	* @param {Object} a The first reference to compare
	* @param {Object} b The second reference to compare
	* @param {Object} step The step object, specifying the rules for comparison
	* @returns {number} A floating value representing the minimum similarity between the two references for this steps rules
	*/
	compareViaStepMin(a, b, step) {
		let minimum = 1;
		step.fields.forEach(field => {
			let score =
				(step.skipOmitted ?? true ) && (!a[field] || !b[field])
					? 0
					: this.comparisons[step.comparison].handler(a[field], b[field])
			if (score < minimum) minimum = score
		})
		return minimum;
	}

	/**
	 * Emit progress throttled every 100ms
	 * @param {number} progress Number between 0 and 1 (inclusive) which represents the progress
	 */
	emitProgress = _.throttle(function(current, max) {
		this.emit('progress', current, max);
	}, 100, { trailing: false });


	/**
	* Run the deduplication process
	* @param {array|string} input Either an existing parsed collection of references or a path to parse
	* @returns {Promise<array>} The output collection with an additional field `dedupe` which is a floating value between 0 - 1
	*
	* @emits runMutated Emitted when the fully mutated library is ready to start deduplicating
	*/
	run(input) {
		var strategy = Dedupe.strategies[this.settings.strategy];
		var output;

		return Promise.resolve()
			.then(()=> {
				if (!Object.values(Dedupe.ACTIONS).includes(this.settings.action)) throw new Error(`Invalid action "${this.settings.action}" - choose one action from Dedupe.ACTIONS`);
				if (!Object.values(Dedupe.DUPEREF).includes(this.settings.dupeRef)) throw new Error(`Invalid dupeRef "${this.settings.dupeRef}" - choose one action from Dedupe.DUPEREF`);

				// Parse inputs if they look like paths, otherwise assume they are given as arrays
				return _.isString(input) ? reflib.promises.parseFile(input) : input;
			})
			// Sanity checks {{{
			.then(refs => {
				if (!_.isArray(refs)) throw new Error('Input is not an array');
				if (!_.has(Dedupe, ['strategies', this.settings.strategy])) throw new Error('Unknown strategy specified');
				if (!_.isArray(_.get(Dedupe, ['strategies', this.settings.strategy, 'steps']))) throw new Error('Invalid strategy schema');
				return output = refs;
			})
			// }}}
			// Validate strategy {{{
			.then(()=> {
				if (!this.settings.validateStrategy) return; // Checking disabled

				var sErrs = this.validateStrategy(strategy);
				if (sErrs === true) return;
				throw new Error('Invalid strategy - ' + sErrs.join(', '));
			})
			// }}}
			// Run mutators {{{
			.then(()=> {
				var refs = output;
				return refs.map((original, index) => ({
					original,
					index,
					recNumber: original.refNumber || index + 1,
					dedupe: {steps: []}, // Storage for future dedupe info
					...original, // Import original reference fields
					..._.mapValues(strategy.mutators, (mutators, field) =>
						_.castArray(mutators).reduce((value, mutator) =>
							this.mutators[mutator].handler(value, original)
						, original[field] || '')
					),
				}));
			})
			// }}}
			.then(refs => {
				this.emit('runMutated', refs);
				var sortedBy; // Keep track of our sort so we don't repeat this
				var sortedRefs; // Current state of refs

				strategy.steps.forEach((step, stepIndex) => { // For each step
					if (!sortedBy || sortedBy != step.sort) { // Sort if needed
						sortedRefs = _.sortBy(refs, step.sort); // Sort by the designated fields
						sortedBy = step.sort;
					}

					var i = 0;
					var n = i + 1;
					while (n < sortedRefs.length) { // Walk all elements of the array...
						// Emit progress
						this.emitProgress(stepIndex * sortedRefs.length + i, strategy.steps.length * sortedRefs.length)
						var dupeScore = this.settings.fieldWeight == Dedupe.FIELDWEIGHT.MINIMUM
							? this.compareViaStepMin(sortedRefs[i], sortedRefs[n], step)
							: this.compareViaStepAvg(sortedRefs[i], sortedRefs[n], step);
						if (dupeScore > 0) { // Hit a duplicate, `i` is now the index of the last unique ref
							// If score does not currently exist for record (i.e. original record) assign it a score of 0 (unless testing)
							if (!sortedRefs[i].dedupe.steps[stepIndex]) {
								sortedRefs[i].dedupe.steps[stepIndex] = {score: this.settings.markOriginal ? dupeScore : 0}; // Mark as duplicate if in testing mode
							}
							// If score does not exist for second record, update score
							if (!sortedRefs[n].dedupe.steps[stepIndex]) {
								// Mark 2nd record as duplicate and link to original
								sortedRefs[n].dedupe.steps[stepIndex] = {score: dupeScore, dupeOf: this.settings.dupeRef == Dedupe.DUPEREF.RECNUMBER ? sortedRefs[i].recNumber : sortedRefs[i].index};
							}
							// Else if new score is greater than or equal the one which exists, update score and dupeof
							else if (dupeScore >= sortedRefs[n].dedupe.steps[stepIndex].score) {
								// Mark 2nd record as duplicate and link to original
								sortedRefs[n].dedupe.steps[stepIndex] = {score: dupeScore, dupeOf: this.settings.dupeRef == Dedupe.DUPEREF.RECNUMBER ? sortedRefs[i].recNumber : sortedRefs[i].index};
							}
							n++; // Increment n by one to compare next record with original to check for multiple dupes
							if (n >= sortedRefs.length) { // If at last record increment i for consistent behaviour
								i++;
								n = i + 1;
							}
						} else {
							if (sortedRefs[i][step.sort] === sortedRefs[n][step.sort]) { // If still the same value for sorted value
								n++; // Increment n by one to compare next record with original to check for multiple dupes
								if (n >= sortedRefs.length) { // If at last record increment i for consistent behaviour
									i++;
									n = i + 1;
								}
							} else {
								// The below may work better if some records are missing data but at the expense of time
								i++;
								n = i + 1;
								// i = n; // Set the new pointer to be the non-matching reference
								// n += 1; // Increment n to point to next reference
							}
						}
					}
				});
				return refs;
			})
			.then(refs => refs.map(ref => ({
				...ref,
				dedupe: {
					...ref.dedupe,
					// Average score for dupes
					score: ref.dedupe.steps.length > 0 ? _.sum(ref.dedupe.steps.map(s => s.score)) / ref.dedupe.steps.length : 0,
				},
			})))
			.then(refs => {
				switch (this.settings.action) {
					case Dedupe.ACTIONS.STATS: // Decorate refs with stats
						return output.map((ref, refIndex) => ({ // Glue the stats back onto the input array
							...ref,
							[this.settings.actionField]: {
								score: refs[refIndex].dedupe.score,
								dupeOf: _(refs[refIndex].dedupe.steps)
									.map('dupeOf')
									.uniq()
									.filter(v => v !== undefined)
									.value(),
							},
						}))

					case Dedupe.ACTIONS.MARK: // Set a simple field if the ref score is above the threshold
						return output.map((ref, refIndex) => ({ // Glue the stats back onto the input array
							...ref,
							[this.settings.actionField]: refs[refIndex].dedupe.score >= this.settings.threshold
								? _.isFunction(this.settings.markDupe) ? this.settings.markDupe(ref) : this.settings.markDupe
								: _.isFunction(this.settings.markOk) ? this.settings.markOk(ref) : this.settings.markOk,
						}))

					case Dedupe.ACTIONS.DELETE: // Remove all refs above the threshold
						return output.filter((ref, refIndex) => refs[refIndex].dedupe.score < this.settings.threshold)
				}
			})
	};
}
