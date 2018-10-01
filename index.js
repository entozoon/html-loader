/*
MIT License http://www.opensource.org/licenses/mit-license.php
Author Tobias Koppers @sokra
*/
var htmlMinifier = require("html-minifier");
var attrParse = require("./lib/attributesParser");
var loaderUtils = require("loader-utils");
var url = require("url");
var assign = require("object-assign");
var compile = require("es6-templates").compile;
var fs = require("fs");

function randomIdent() {
	return (
		"xxxHTMLLINKxxx" + Math.random() + Math.random() + "xxxthiscodeissodumbxxx"
	);
}

function randomIdentWithProps(props) {
	if (!props) return randomIdent();
	return (
		"xxxHTMLLINKxxx" +
		Math.random() +
		Math.random() +
		"{" +
		props +
		// JSON.stringify(props) +
		"}xxxthiscodeissodumbxxx"
	);
}

function getLoaderConfig(context) {
	var query = loaderUtils.getOptions(context) || {};
	var configKey = query.config || "htmlLoader";
	var config =
		context.options && context.options.hasOwnProperty(configKey)
			? context.options[configKey]
			: {};

	delete query.config;

	return assign(query, config);
}

module.exports = function(content, dwa) {
	this.cacheable && this.cacheable();
	var config = getLoaderConfig(this);
	var attributes = ["img:src"];
	if (config.attrs !== undefined) {
		if (typeof config.attrs === "string") attributes = config.attrs.split(" ");
		else if (Array.isArray(config.attrs)) attributes = config.attrs;
		else if (config.attrs === false) attributes = [];
		else throw new Error("Invalid value to config parameter attrs");
	}

	var root = config.root;
	var links = attrParse(content, function(tag, attr) {
		var res = attributes.find(function(a) {
			if (a.charAt(0) === ":") {
				return attr === a.slice(1);
			} else {
				return tag + ":" + attr === a;
			}
		});
		return !!res;
	});
	links.reverse();
	var data = {};
	var props = {};
	content = [content];
	links.forEach(function(link) {
		if (!loaderUtils.isUrlRequest(link.value, root)) return;
		if (link.value.indexOf("mailto:") > -1) return;
		var uri = url.parse(link.value);
		if (uri.hash !== null && uri.hash !== undefined) {
			uri.hash = null;
			link.value = uri.format();
			link.length = link.value.length;
		}
		do {
			var ident = randomIdent();
		} while (data[ident]);
		data[ident] = link.value;
		var x = content.pop();
		content.push(x.substr(link.start + link.length));
		content.push(ident);
		content.push(x.substr(0, link.start));
	});
	content.reverse();
	content = content.join("");
	if (config.interpolate === "require") {
		var reg = /\$\{require\([^)]*\)[^}]*\}/g;
		var result;
		var reqList = [];
		props = {};
		while ((result = reg.exec(content))) {
			reqList.push({
				length: result[0].length,
				start: result.index,
				value: result[0]
			});
		}
		reqList.reverse();
		content = [content];
		reqList.forEach(function(link) {
			var x = content.pop();

			// Get any prop values
			// [ 'foo="bar"', 'baz="jizz"' ]
			var propList = link.value.match(/\b([^\s]+)(="[^\"]*")/gi);
			if (propList) {
				propList.forEach(function(prop) {
					var pair = prop.split("=");
					props[pair[0]] = pair[1].substring(1, pair[1].length - 1);
				});
			}

			do {
				// Shove props into ident
				var ident = randomIdentWithProps(propList);
			} while (data[ident]);
			// Sprinkling some myke magic to allow flexibility for requires with props
			data[ident] = /\([^)]*\)/g.exec(link.value)[0].slice(2, -2);
			content.push(x.substr(link.start + link.length));
			content.push(ident);
			content.push(x.substr(0, link.start));
		});
		content.reverse();
		content = content.join("");
	}
	if (typeof config.minimize === "boolean" ? config.minimize : this.minimize) {
		var minimizeOptions = assign({}, config);
		[
			"removeComments",
			"removeCommentsFromCDATA",
			"removeCDATASectionsFromCDATA",
			"collapseWhitespace",
			"conservativeCollapse",
			"removeAttributeQuotes",
			"useShortDoctype",
			"keepClosingSlash",
			"minifyJS",
			"minifyCSS",
			"removeScriptTypeAttributes",
			"removeStyleTypeAttributes"
		].forEach(function(name) {
			if (typeof minimizeOptions[name] === "undefined") {
				minimizeOptions[name] = true;
			}
		});
		content = htmlMinifier.minify(content, minimizeOptions);
	}
	if (config.interpolate && config.interpolate !== "require") {
		// Double escape quotes so that they are not unescaped completely in the template string
		content = content.replace(/\\"/g, '\\\\"');
		content = content.replace(/\\'/g, "\\\\'");
		content = compile("`" + content + "`").code;
	} else {
		content = JSON.stringify(content);
	}
	var exportsString = "module.exports = ";
	if (config.exportAsDefault) {
		exportsString = "exports.default = ";
	} else if (config.exportAsEs6Default) {
		exportsString = "export default ";
	}
	content = content.replace(/xxxHTMLLINKxxx.*xxxthiscodeissodumbxxx/g, function(
		match
	) {
		match = match.replace(/\\"/g, '"');
		if (!data) return match;
		var path = data[match];
		if (!path) return match;

		var urlToRequest = loaderUtils.urlToRequest(path, root);

		let fileContent = fs.readFileSync(urlToRequest, "utf8");
		var contentUpdated = JSON.stringify(fileContent);

		// Get the props again from the insane ident
		var props = {};
		var propList = match.match(/{\b([^\s]+)(="[^\"]*"})/gi);
		if (propList) {
			propList.forEach(function(prop) {
				var pair = prop.slice(1, prop.length - 1).split("=");
				props[pair[0]] = pair[1].substring(1, pair[1].length - 1);
			});
		}

		contentUpdated = contentUpdated.replace(/\$\{props.[^}]+\}/g, function(
			match
		) {
			// Sometimes I like the way I code; KISS Method
			var propKey = match.substring(
				"${props.".length,
				match.length - "}".length
			);
			return props[propKey] ? props[propKey] : "";
		});

		return '" + ' + contentUpdated + ' + "';
	});
	return exportsString + content + ";";
};
