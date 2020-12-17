"use strict";

module.exports = ( grunt ) => {

const _ = require( "lodash" );
const semver = require( "semver" );
const Handlebars = require( "handlebars" );
const CLIEngine = require( "eslint" ).CLIEngine;

grunt.loadNpmTasks( "grunt-contrib-clean" );
grunt.loadNpmTasks( "grunt-eslint" );
grunt.loadNpmTasks( "grunt-sri" );

grunt.initConfig( {
	clean: {
		dist: {
			src: [ "dist" ]
		}
	},

	eslint: {
		options: {
			maxWarnings: 0
		},

		// We have to explicitly declare "src" property otherwise "newer"
		// task wouldn't work properly :/
		dist: {
			src: [ "dist/jquery.js", "dist/jquery.min.js" ]
		},
		dev: {
			src: [
				"Gruntfile.js",

				// Ignore files from .eslintignore
				// See https://github.com/sindresorhus/grunt-eslint/issues/119
				...new CLIEngine()
					.getConfigForFile( "Gruntfile.js" )
					.ignorePatterns.map( ( p ) => `!${ p }` )
			]
		}
	},

	sri: {
		generate: {
			src: [
				"cdn/**/*.js",
				"cdn/**/*.css"
			],
			options: {
				algorithms: [ "sha256" ],
				dest: "dist/resources/sri-directives.json"
			}
		}
	}
} );

grunt.registerTask( "build-pages", function() {
	const rversion = /^(\d+)\.(\d+)(?:\.(\d+))?-?(.*)$/;

	function normalizeVersion( version ) {
		const match = rversion.exec( version );

		return match[ 1 ] + "." + match[ 2 ] + "." + ( match[ 3 ] || 0 ) +
			( match[ 4 ] ? "-" + match[ 4 ] : "" );
	}

	function camelCase( str ) {
		return str.replace( /-([a-z])/g, ( _$0, $1 ) => $1.toUpperCase() );
	}

	function getLatestStable( releases ) {
		return _.find( releases, ( release ) => release.version.indexOf( "-" ) === -1 );
	}

	function parseReleases( files, regex ) {
		return files
			.map( ( filename ) => {
				const matches = regex.exec( filename );

				// matches[ 3 ] = "min" or "pack" or ""
				if ( !matches || matches[ 3 ] ) {
					return null;
				}

				return {
					filename: matches[ 0 ],
					version: normalizeVersion( matches[ 2 ] )
				};
			} )

			// Remove null values from filtering
			.filter( _.identity )
			.sort( ( a, b ) => semver.compare( b.version, a.version ) );
	}

	// Filter out non-stable releases via a semver trick.
	function parseStableReleases() {
		return parseReleases.apply( null, arguments )
			.filter( ( release ) => semver.satisfies( release.version, ">=0" ) );
	}

	function groupByMajor( releases ) {
		return _( releases )
			.groupBy( ( release ) => semver.major( release.version ) )
			.map( ( group, key ) => [ key, group ] )
			.sortBy( ( group ) => group[ 0 ] )
			.reverse()
			.value();
	}

	function getCoreData() {
		const files = grunt.file.expand( "cdn/*.js" ),
			coreReleases = parseStableReleases( files,
				/(jquery-(\d+\.\d+(?:\.\d+)?[^.]*)(?:\.(min|pack))?\.js)/ ),
			coreReleasesGrouped = groupByMajor( coreReleases ),
			migrateReleases = parseStableReleases( files,
				/(jquery-migrate-(\d+\.\d+(?:\.\d+)?[^.]*)(?:\.(min))?\.js)/ );

		function addTypes( release ) {
			const minFilename = release.filename.replace( ".js", ".min.js" ),
				packFilename = release.filename.replace( ".js", ".pack.js" ),
				slimFilename = release.filename.replace( ".js", ".slim.js" ),
				slimMinFilename = release.filename.replace( ".js", ".slim.min.js" );

			if ( files.indexOf( "cdn/" + minFilename ) !== -1 ) {
				release.minified = minFilename;
			}
			if ( files.indexOf( "cdn/" + packFilename ) !== -1 ) {
				release.packed = packFilename;
			}
			if ( files.indexOf( "cdn/" + slimFilename ) !== -1 ) {
				release.slim = slimFilename;
			}
			if ( files.indexOf( "cdn/" + slimMinFilename ) !== -1 ) {
				release.slimMinified = slimMinFilename;
			}
		}

		coreReleasesGrouped.forEach( ( group ) => {
			group[ 1 ].forEach( addTypes );
		} );
		migrateReleases.forEach( addTypes );

		const index = {
			jquery: [],
			migrate: {
				latestStable: getLatestStable( migrateReleases ),
				all: migrateReleases
			}
		};

		coreReleasesGrouped.forEach( ( group ) => {
			index.jquery.push( [ group[ 0 ], {
				latestStable: getLatestStable( group[ 1 ] ),
				all: group[ 1 ]
			} ] );
		} );

		return index;
	}

	function getUiData() {
		const majorReleases = {},
			uiReleases = grunt.file.expand( { filter: "isDirectory" }, "cdn/ui/*" )
				.map( ( dir ) => {
					const filename = dir.substring( 4 ) + "/jquery-ui.js";

					return {
						filename: filename,
						version: dir.substring( 7 ),
						minified: filename.replace( ".js", ".min.js" ),
						themes: grunt.file.expand( { filter: "isDirectory" }, dir + "/themes/*" )
							.map( ( themeDir ) => themeDir.substring( dir.length + 8 ) )
					};
				} )
				.sort( ( a, b ) => semver.compare( b.version, a.version ) );

		// Group by major release
		uiReleases.forEach( ( release ) => {
			const major = /^\d+\.\d+/.exec( release.version )[ 0 ];
			if ( !majorReleases[ major ] ) {
				majorReleases[ major ] = [];
			}

			majorReleases[ major ].push( release );
		} );

		// Convert to array of major release groups
		return Object.keys( majorReleases ).map( ( major ) => {
			const all = majorReleases[ major ],
				latestStable = getLatestStable( all );

			return {
				major: major,
				latestStable: latestStable,
				all: all.filter( ( release ) => release !== latestStable )
			};
		} );
	}

	function getMobileData() {
		const files = grunt.file.expand( "cdn/mobile/*/*.css" ),
			releases = files.map( ( file ) => {
				const version = /cdn\/mobile\/([^\/]+)/.exec( file )[ 1 ],
					filename = "mobile/" + version + "/jquery.mobile-" + version + ".js",
					mainCssFile = "cdn/" + filename.replace( ".js", ".css" );

				if ( file !== mainCssFile ) {
					return null;
				}

				return {
					filename: filename,
					version: normalizeVersion( version )
				};
			} )

			// Remove null values from filtering
				.filter( _.identity )
				.sort( ( a, b ) => semver.compare( b.version, a.version ) );

		function addTypes( release ) {
			const minFilename = release.filename.replace( ".js", ".min.js" ),
				css = release.filename.replace( ".js", ".css" ),
				minCss = css.replace( ".css", ".min.css" ),
				structure = css.replace( "jquery.mobile", "jquery.mobile.structure" ),
				minStructure = structure.replace( ".css", ".min.css" );

			release.minified = minFilename;
			release.css = css;
			release.minifiedCss = minCss;

			if ( files.indexOf( "cdn/" + structure ) !== -1 ) {
				release.structure = structure;
				release.minifiedStructure = minStructure;
			}
		}

		releases.forEach( addTypes );

		return {
			latestStable: getLatestStable( releases ),
			all: releases
		};
	}

	function getColorData() {
		const files = grunt.file.expand( "cdn/color/*.js" ),
			releases = parseStableReleases( files,
				/(color\/jquery.color-(\d+\.\d+(?:\.\d+)?[^.]*)(?:\.(min))?\.js)/ ),
			modes = [ "svg-names", "plus-names" ];

		function addTypes( release ) {
			release.minified = release.filename.replace( ".js", ".min.js" );

			modes.forEach( ( mode ) => {
				const filename = release.filename.replace( "jquery.color", "jquery.color." + mode ),
					minFilename = filename.replace( ".js", ".min.js" );

				if ( files.indexOf( "cdn/" + filename ) !== -1 ) {
					release[ camelCase( mode ) ] = {
						filename: filename,
						version: release.version,
						minified: minFilename
					};
				}
			} );
		}

		releases.forEach( addTypes );

		return {
			latestStable: getLatestStable( releases ),
			all: releases
		};
	}

	function getQunitData() {
		const files = grunt.file.expand( "cdn/qunit/*.js" ),
			releases = parseStableReleases( files,
				/(qunit\/qunit-(\d+\.\d+\.\d+[^.]*)(?:\.(min))?\.js)/ );

		releases.forEach( ( release ) => {
			release.theme = release.filename.replace( ".js", ".css" );
		} );

		return {
			latestStable: getLatestStable( releases ),
			all: releases
		};
	}

	function getPepData() {
		const releases = grunt.file.expand( { filter: "isDirectory" }, "cdn/pep/*" )
			.map( ( dir ) => {
				const filename = dir.substring( 4 ) + "/pep.js";

				return {
					filename: filename,
					version: dir.substring( 8 ),
					minified: filename.replace( ".js", ".min.js" )
				};
			} )
			.sort( ( a, b ) => semver.compare( b.version, a.version ) );

		return {
			latestStable: getLatestStable( releases ),
			all: releases
		};
	}

	const sriHashes = require( "./dist/resources/sri-directives.json" );

	function href( file, label ) {
		const sri = "sha256-" + sriHashes[ "@cdn/" + file ].hashes.sha256;
		return "<a class='open-sri-modal' href='/" + file + "' data-hash='" + sri + "'>" +
			label + "</a>";
	}

	Handlebars.registerHelper( "ifeq", function( v1, v2, options ) {
		if ( v1 === v2 ) {
			return options.fn( this );
		}
		return options.inverse( this );
	} );

	Handlebars.registerHelper( "sriLink", function( file, label ) {
		return new Handlebars.SafeString( href( file, label ) );
	} );

	Handlebars.registerHelper( "release", function( prefix, release ) {
		let html = prefix + " " + release.version + " - " +
			href( release.filename, "uncompressed" );
		if ( release.minified ) {
			html += ", " + href( release.minified, "minified" );
		}
		if ( release.packed ) {
			html += ", " + href( release.packed, "packed" );
		}
		if ( release.slim ) {
			html += ", " + href( release.slim, "slim" );
		}
		if ( release.slimMinified ) {
			html += ", " + href( release.slimMinified, "slim minified" );
		}

		return new Handlebars.SafeString( html );
	} );

	Handlebars.registerHelper( "uiTheme", function( release ) {
		let url;

		// TODO: link to minified theme if available
		if ( release.themes.indexOf( "smoothness" ) !== -1 ) {
			url = "smoothness/jquery-ui.css";
		} else {
			url = "base/jquery-ui.css";
		}

		return new Handlebars.SafeString(
			"<a href='/ui/" + release.version + "/themes/" + url + "'>theme</a>" );
	} );

	Handlebars.registerHelper( "include", ( () => {
		const templates = {};
		return function( template ) {
			if ( !templates.hasOwnProperty( template ) ) {
				templates[ template ] = Handlebars.compile(
					grunt.file.read( "templates/" + template + ".hbs" ) );
			}

			return new Handlebars.SafeString( templates[ template ]( this ) );
		};
	} )() );

	const data = getCoreData();
	data.ui = getUiData();
	data.mobile = getMobileData();
	data.color = getColorData();
	data.qunit = getQunitData();
	data.pep = getPepData();

	grunt.file.write( "dist/pages/posts/page/index.html",
		Handlebars.compile( grunt.file.read( "templates/index.hbs" ) )( data ) );

	grunt.file.write( "dist/pages/posts/page/jquery.html",
		Handlebars.compile( grunt.file.read( "templates/jquery.hbs" ) )( data ) );

	grunt.file.write( "dist/pages/posts/page/ui.html",
		Handlebars.compile( grunt.file.read( "templates/ui.hbs" ) )( data ) );

	grunt.file.write( "dist/pages/posts/page/mobile.html",
		Handlebars.compile( grunt.file.read( "templates/mobile.hbs" ) )( data ) );

	grunt.file.write( "dist/pages/posts/page/color.html",
		Handlebars.compile( grunt.file.read( "templates/color.hbs" ) )( data ) );

	grunt.file.write( "dist/pages/posts/page/qunit.html",
		Handlebars.compile( grunt.file.read( "templates/qunit.hbs" ) )( data ) );

	grunt.file.write( "dist/pages/posts/page/pep.html",
		Handlebars.compile( grunt.file.read( "templates/pep.hbs" ) )( data ) );
} );

grunt.registerTask( "ensure-dist-resources", function() {
	grunt.file.mkdir( "dist/resources" );
} );

grunt.registerTask( "sri-generate", [ "ensure-dist-resources", "sri:generate" ] );

// The "grunt" command is automatically invoked on git-commit by the server that
// will deploy the site.
grunt.registerTask( "build", [ "clean", "sri-generate", "build-pages" ] );
grunt.registerTask( "default", [ "build" ] );

};
