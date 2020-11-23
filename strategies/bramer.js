module.exports = {
	title: 'Bramer et. al.',
	description: '<a href="https://doi.org/10.3163/1536-5050.104.3.014">Bramer et. al.</a> deduplication sweep strategy',
	mutators: {
		author: 'authorRewrite',
		doi: 'doiRewrite',
		title: ['deburr', 'alphaNumericOnly', 'noCase'],
		year: 'numericOnly',
	},
	steps: [
		{
			fields: ['doi'],
			sort: 'doi',
			comparison: 'exact',
		},
		{
			fields: ['author', 'year', 'title', 'journal'],
			sort: 'title',
			comparison: 'exact',
		},
		{
			fields: ['author', 'year', 'title', 'pages'],
			sort: 'pages',
			comparison: 'exact',
		},
		{
			fields: ['title', 'volume', 'pages'],
			sort: 'title',
			comparison: 'exact',
		},
		{
			fields: ['authors', 'volume', 'pages'],
			sort: 'title',
			comparison: 'exact',
		},
		{
			fields: ['year', 'volume', 'issue', 'pages'],
			sort: 'title',
			comparison: 'exact',
		},
		{
			fields: ['title'],
			sort: 'title',
			comparison: 'exact',
		},
		{
			fields: ['authors', 'year'],
			sort: 'title',
			comparison: 'exact',
		},
	],
};
