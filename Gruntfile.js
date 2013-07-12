'use strict';

module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    // Metadata.
    pkg: grunt.file.readJSON('crocodile-rtc.jquery.json'),
    banner: '/*! <%= pkg.title || pkg.name %> - v<%= pkg.version %> - ' +
      '<%= grunt.template.today("yyyy-mm-dd") %>\n' +
      '<%= pkg.homepage ? "* " + pkg.homepage + "\\n" : "" %>' +
      '* Copyright (c) <%= grunt.template.today("yyyy") %> <%= pkg.author.name %>;' +
      ' Licensed <%= _.pluck(pkg.licenses, "type").join(", ") %>\n' +
      '*\n' +
      '* Incorporates the following third-party open source software:\n' +
      '*\n' +
      '* JsSIP (http://www.jssip.net/)\n' +
      '*  Copyright (c) 2012-2013 José Luis Millán - Versatica\n' +
      '*  License: MIT\n' +
      '*\n' +
      '* JSJaC (https://github.com/sstrigler/JSJaC)\n' +
      '*  Copyright (c) 2004-2008 Stefan Strigler\n' +
      '*  License: MPL-1.1/GPL-2.0+/LGPL-2.1+\n' +
      '*/\n',
    // Task configuration.
    clean: {
      files: ['dist']
    },
    concat: {
      options: {
        banner: '<%= banner %>',
        stripBanners: true,
        process: true
      },
      dist: {
        src: [
          'libs/jssip/jssip.js',
          'libs/crocodile-msrp/crocodile-msrp.js',
          'libs/jsjac/jsjac.uncompressed.js',
          'src/CrocSdk.js',
          'src/Capability.js',
          'src/Constants.js',
          'src/Data.js',
          'src/Exceptions.js',
          'src/Media.js',
          'src/MediaSession.js',
          'src/MsrpDataSession.js',
          'src/Sdp.js',
          'src/SipDataSession.js',
          'src/Util.js',
          'src/XmppDataSession.js',
          'src/XmppPresence.js',
          'src/crocodile-rtc.js'
        ],
        dest: 'dist/<%= pkg.name %>.js'
      },
    },
    uglify: {
      options: {
        banner: '<%= banner %>'
      },
      dist: {
        src: '<%= concat.dist.dest %>',
        dest: 'dist/<%= pkg.name %>.min.js'
      },
    },
    qunit: {
      files: ['test/**/*.html']
    },
    jshint: {
      gruntfile: {
        options: {
          jshintrc: '.jshintrc'
        },
        src: 'Gruntfile.js'
      },
      src: {
        options: {
          jshintrc: 'src/.jshintrc'
        },
        src: ['src/**/*.js']
      },
      test: {
        options: {
          jshintrc: 'test/.jshintrc'
        },
        src: ['test/**/*.js']
      },
    },
    watch: {
      gruntfile: {
        files: '<%= jshint.gruntfile.src %>',
        tasks: ['jshint:gruntfile']
      },
      src: {
        files: '<%= jshint.src.src %>',
        tasks: ['jshint:src', 'qunit']
      },
      test: {
        files: '<%= jshint.test.src %>',
        tasks: ['jshint:test', 'qunit']
      },
    },
    jsdoc: {
      dist: {
        src: ['src/*.js', 'jsdoc-overview.md'],
        options: {
          destination: 'dist/doc',
          private: false,
          template: 'jsdoc/templates/crocodile',
        },
      },
    },
    copy: {
      main: {
        files: [
          {expand: true, src: ['resources/*'], dest: 'dist/doc/', filter: 'isFile'}
        ],
      },
    },
  });

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-qunit');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-jsdoc');

  // Default task.
  grunt.registerTask('default', [
    'jshint',
    //'qunit', // Disable until PhantomJS supports WebSockets properly (https://github.com/ariya/phantomjs/issues/11018)
    'clean',
    'concat',
    'uglify',
	'jsdoc',
    'copy',
  ]);

};
