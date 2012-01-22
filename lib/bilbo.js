
// A static site generator writen in node. It's lyke Jehyll but somewhat simpler and more focused.
// takes a `src` folder, runs it through Markdown and generate for each markdown file (.md, .mkd, .markdown)
// a complete, static website.

var path = require('path'),
  connect = require('connect'),
  fs = require('fs'),
  Glob = require("glob").Glob,
  ghm = require('github-flavored-markdown'),
  connect = require('connect'),
  Mustache = require('mustache'),
  prettify = require('./vendor/prettify'),
  exec = require('child_process').exec;


var basePath = process.cwd(),

ensureDir = function ensureDir(dir, callback) {
  // todo: tweak this
  return fs.mkdir(dir, 0777, function(err) {
    return callback();
  });
},

// little helper to recursively copy a directory from src to dir
copyDir = function copyDir(src, to, callback) {
  return exec('rm -r ' + to, function(err) {
    return exec('cp -r ' + src + ' '+ to, callback);
  });
},

// escapes internal wiki anchors, in both case, prefix with config.baseurl
// except from external link. links with `//` are assumed to be external
wikiAnchors = function wikiAnchors(text, config) {
  var bu = config.baseurl;
  text = text.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, function(wholeMatch, m1, m2) {
    var ext = /\/\//.test(m2),
      p = ext ? m2 : path.join(bu, m2.split(' ').join('-'));

    return "["+m1+"](" + p + ")";
  });

  text = text.replace(/\[\[([^\]]+)\]\]/g, function(wholeMatch, m1) {
    return "["+m1+"](" + path.join(bu, m1.split(' ').join('-')) + "/)";
  });

  return text;
},

// escapes special ``` codeblock
escapeCodeBlock = function(text) {
  text = text.replace(/```(\w+)([^`]+)```/g, function(wholeMatch, language, code) {
    var lines = wholeMatch.split('\n');
    // get rid of first and last line -> ```language ànd ```
    lines = lines.slice(1, -1);


    // add desired tab space
    lines = lines.map(function(line) {
      // for some reason, external url mess up with pretiffy highligh
      return '    ' + line.replace(/(http|https):\/\//g, '');
    });

    return lines.join('\n');
  });

  return text;
},

// code highlighting helper. It uses prettify and run it against any `<pre><code>` element
codeHighlight = function codeHighlight(str) {
  return str.replace(/<code>[^<]+<\/code>/g, function (code) {
    code = code.match(/<code>([\s\S]+)<\/code>/)[1];
    code = prettify.prettyPrintOne(code);
    return "<code>" + code + "</code>";
  });
},

// markdown parser to html and makes sure that code snippets are pretty enough
toHtml = function toHtml(markdown, config) {
  return codeHighlight( ghm.parse( wikiAnchors( escapeCodeBlock( markdown ), config) ) );
},


// start up a connect server with static middleware.
server = function server(config) {
  // but only for configuration with config.server set to true (--server)
  if(!config.server) return;
  connect.createServer()
    .use(connect.logger({format: '> :date :method :url'}))
    .use(connect.favicon(path.join(__dirname, '../public/favicon.ico')))
    .use(config.baseurl || '', connect.static(path.join(config.dest)))
    .listen(config.port);

  console.log('\nServer started: localhost:', config.port);
},

// assets copy helper, fallbacks if necessary
copyAssets = function copyAssets(config) {
  var src = config.assets ? config.assets : path.resolve(__dirname, 'templates/public'),
    to = path.resolve(config.dest, 'public');

  return copyDir(src, to, function(err) {
    if(err) throw err;
  });
},

// utilty helper to determine which layout to use. It first tries to
// get a layout template from where the excutable was used, it then fallbacks
// to the default layout.
computeLayout = function(config) {
  var layout;

  try {
    layout = fs.readFileSync(path.join(basePath, config.layout), 'utf8').toString();
  } catch (e) {
    console.log('Unable to find ', path.join(basePath, config.layout), '. Fallback to ', path.join(__dirname, 'templates/index.html'));
    layout = fs.readFileSync(path.join(__dirname, 'templates/index.html'), 'utf8').toString();
  }

  return layout;
};


// ### main process function.
// Scans the `src` whole directory,

exports = module.exports = function process(config) {

  var files = [],
    fileReg = new RegExp('\\.' + config.ext.join('$|\\.') + '$'),
    layoutTmpl = computeLayout(config),
    destPath = path.join(basePath, config.dest),
    srcPath = path.join(basePath, config.src),
    print = function print() {
      if(!config.verbose) { return; }
      console.log.apply(console, arguments);
    };

  // scans the whole dir
  ensureDir(destPath, function process() {

    print('Generating website with configuration --> ', config);

    new Glob('**/*.md')
      .on('match', function(file) {
        // normalize the path for win care
        file = path.normalize(file);

        if(!fileReg.test(file)) {
          // prevent non markdown files
          return;
        }

        // compute file's title: filename minus extension and -
        // compute href: filename/index.html
        // also takes care of files beginning by `.` like `.htaccess`

        var filename = file.replace(srcPath + path.join('/'), '').replace(fileReg, '').replace(/^\./, ''),
          title = filename.replace(/-/g, ' '),
          href = title === 'Home' ? '/' : [destPath, path.basename(filename), ''].join('/').replace(destPath, '');

        console.log(destPath, href);
        files.push({
          path: file,
          // unix like path splitting for hrefs
          href: [config.baseurl, href].join('/').replace(/\/\//g, '/'),
          filename: filename,
          title: title
        });
      })

      .on('end', function() {
        console.log('end man end', arguments);
        var fileCount = files.length, layout;
        print('About to generate ', files.length, ' files \n\n');
        print('Writing Home Page to ', path.join(destPath, 'index.html'));

        files = files.sort(function(a, b) {
          var left = a.title.toLowerCase(),
            right = b.title.toLowerCase();

          if(left === right) return 0;
          return right < left ? 1 : -1;
        });

        files.forEach(function(file) {
          var output = toHtml(fs.readFileSync(file.path, 'utf8'), config),
            dest = path.join(destPath, file.title === 'Home' ? '' : file.filename),
            edit;

          // generate edit this page link, todo: set it part of the template
          // todo: the url needs to be a configuration option, or guessed from git current repo optionnaly
          // todo: the markup needs to be put elsewhere, probably through one of layouts/ template
          edit = '<a class="edit-page" href="//github.com/h5bp/html5-boilerplate/wiki/:filename/_edit">Edit this page</a>'
            .replace(':filename', file.filename);

          output = Mustache.to_html(layoutTmpl, {
            baseurl: config.baseurl,
            title: file.title,
            content: output,
            href: file.href,
            edit: edit,
            files: files
          });

          ensureDir(dest, function() {
            print('bilbo-docs: ', file.title, ' -> ', path.join(dest, 'index.html').replace(destPath, ''));
            fs.writeFileSync(path.join(dest, 'index.html'), output, 'utf8');

            if((fileCount--) === 1) {
              // undefined assets -> copy of local public folder
              // false assets -> prevent the copy
              // any other value will copy over the assets folder.
              if(config.assets !== false) copyAssets(config);
              server(config);
            }
          });

        });
      });
  });

};