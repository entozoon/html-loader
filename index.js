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

function randomIdent() {
	return "xxxHTMLLINKxxx" + Math.random() + Math.random() + "xxx";
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

module.exports = function(content) {
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
		let props = {};
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
			do {
				var ident = randomIdent();
			} while (data[ident]);
			// Sprinkling some myke magic to allow flexibility for adding other attributes as params
			data[ident] = /\([^)]*\)/g.exec(link.value)[0].slice(2, -2);
			content.push(x.substr(link.start + link.length));
			content.push(ident);
			content.push(x.substr(0, link.start));
			// Get any prop values
			// [ 'foo="bar"', 'baz="jizz"' ]
			let propList = link.value.match(/\b([^\s]+)(="(^'|^"|[^\s]+)*")/gi);
			if (propList) {
				propList.forEach(prop => {
					let pair = prop.split("=");
					props[pair[0]] = pair[1].substring(1, pair[1].length - 1);
				});
			}
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

	content = content.replace(/xxxHTMLLINKxxx[0-9\.]+xxx/g, function(match) {
		if (!data[match]) return match;

		var urlToRequest;

		if (config.interpolate === "require") {
			urlToRequest = data[match];
		} else {
			urlToRequest = loaderUtils.urlToRequest(data[match], root);
		}

		return '" + require(' + JSON.stringify(urlToRequest) + ') + "';
	});

	content = content.replace(/\$\{props.[^}]+\}/g, match => {
		// Sometimes I like the way I code; KISS Method
		let propKey = match.substring("${props.".length, match.length - "}".length);
		return props[propKey] ? props[propKey] : "";
	});

	return exportsString + content + ";";
};
