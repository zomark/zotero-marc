{
        "translatorID":"d9be67f5-c9fa-42df-aa62-e2fa3c43cd4d",
        "label":"Bibliothèque nationale de France (MARC2)",
        "creator":"Florian Ziche",
        "target":"^https?://[^/]*catalogue\\.bnf\\.fr",
        "minVersion":"2.0",
        "maxVersion":"",
        "priority":100,
        "inRepository":true,
        "translatorType":4,
        "lastUpdated":"2010-10-03 16:10:08"
}

/*
 *  Bibliothèque nationale de France Translator
 *  Copyright (C) 2010 Florian Ziche, ziche@noos.fr
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/


/**
 * @namespace Bnf helpers.
 **/
var Bnf = new function() {
	
	/* MARC translator. */
	this.Marc = undefined;

	//Private members

	//Translate BnF types to Zotero item types.
	function getItemType(type) {
		switch(type) {
		case "Enregistrement sonore":
			return "audioRecording";
		case "Image fixe":
		case "Image fixe numérisée":
			return "artwork";
		case "Images animées":
			return "film";
		case "Ressource électronique":
			return "computerProgram";
		case "Document cartographique":
			return "map";
		case "Document d'archives":
			return "document";
		case "Texte manuscrit":
			return "manuscript";
		case "Multimédia multisupport":
		case "Musique imprimé":
		case "Texte imprimé":
		default:
			return "book";	
		}	
	};

	/* Get the UNIMARC URL for a given single result page. */
	function reformURL(url) {
		return url.replace(/&FormatAffichage=[^&]*/, "")
			.replace(/&idNoeud=[^&]*/, "") + "&FormatAffichage=4";
	};

	//Check for Gallica URL (digital version available), if found, set item.url
	function checkGallica(doc, item) {
		var namespace = doc.documentElement.namespaceURI;
		var nsResolver = namespace ? function(prefix) {
		  if (prefix == 'x') return namespace; else return null;
		} : null;
		
		var url = false;
		//Check for links containing the "Visualiser" img
		var elmts = doc.evaluate('//a[img[@src="/images/boutons/bouton_visualiser.gif"]]',
	            doc, nsResolver, XPathResult.ANY_TYPE, null);
		if(elmts) {
			var link;
			while(link = elmts.iterateNext()) {
				url = link.href;
				break;
			}
		}
		
		if(url) {
			item.url = url;
		}
	};
	


	/* Load MARC translator. */
	this.loadMarcTranslator = function() {
		if(!this.Marc) {
			var translator = Zotero.loadTranslator("import");
			translator.setTranslator("d2c86970-04f7-4ba5-9de6-bec897930eb5");
			this.Marc = translator.getTranslatorObject().Marc;
		}
		return this.Marc;
	};

	//Do BnF specific Unimarc postprocessing
	this.postprocessItem = function(item, record, doc) {
		//Type
		record.dump();
		var t = record.getFields(Bnf.Marc.Unimarc.Tags.TITLE_AND_STATEMENT_OF_RESPONSIBILITY)[0].getValue("b");
		if(t && t.length) {
			item.itemType = getItemType(t);
		}

		//Store perennial url from 009 as attachment and accession number
		var url = record.getValue("009");
		if(url && url.length) {
			item.accessionNumber = url;
			item.attachments = [
				{
					url: url,
					title: "Bnf catalogue entry", 
					mimeType: "text/html", 
					snapshot:false
				}
			];
		}

		//Repository
		item.libraryCatalog = "French National Library Online Catalog (http://catalogue.bnf.fr)";
		
		//URL
		checkGallica(doc, item);
	};


	/* Get the results table from a list page, if any. Looks for //table[@class="ListeNotice"]. */
	this.getResultsTable = function(doc) {
		var namespace = doc.documentElement.namespaceURI;
		var nsResolver = namespace ? function(prefix) {
			if (prefix == 'x') return namespace; else return null;
		} : null;
		try {
			var xPath = '//table[@class="ListeNotice"]';
			var xPathObject = doc.evaluate(xPath, doc, nsResolver, XPathResult.ANY_TYPE, null).iterateNext();
			return xPathObject;
		} catch(x) {
			Zotero.debug(x.lineNumber + " " + x.message);
		}
		return undefined;
	};

	/* Get the DC type from the web page. Returns the first DC.type from meta tags. 
		2010-10-01: No DC meta tags any more... simply test for //td[@class="texteNotice"] cells and return "printed text".
		2010-10-11: DC tags are back
	*/
	this.getDCType = function(doc, url) {
		var namespace = doc.documentElement.namespaceURI;
		var nsResolver = namespace ? function(prefix) {
			if (prefix == 'x') return namespace; else return null;
		} : null;
		try {
			var xPath = '//head/meta[@name="DC.type" and @lang="eng"]/@content';
			var xPathObject = doc.evaluate(xPath, doc, nsResolver, XPathResult.ANY_TYPE, null).iterateNext();
			if(!xPathObject) {
				xPath = '//td[@class="texteNotice"]';
				xPathObject = doc.evaluate(xPath, doc, nsResolver, XPathResult.ANY_TYPE, null).iterateNext();
			}
			return xPathObject ? "printed text" : undefined;
		} 
		catch(x) {
			Zotero.debug(x.lineNumber + " " + x.message);
		}
		return undefined;
	};

	/* Translate a DC type to a corresponding Zotero item type. Currently obsolete. */
	this.translateDCType = function(type) {
		switch(type) {
		case "printed text":
		case "text":
			return "book";
		case "sound recording":
			return "audioRecording";
		default:
			return type;
		}
	};

	
	/* Get selectable search items from a list page. 
		Loops through //td[@class="mn_partienoticesynthetique"], extracting the single items URLs from
		their onclick attribute, their titles by assembling the spans for each cell.
	*/
	this.extractMarcUrls = function(doc) {
		var items = new Object();
		var urls = [];
		var baseUri = /^(https?:\/\/[^\/]+)/.exec(doc.location.href)[1];
		
		if(detectWeb(doc, doc.location.href) == "multiple") {
			var namespace = doc.documentElement.namespaceURI;
			var nsResolver = namespace ? function(prefix) {
				  if (prefix == 'x') return namespace; else return null;
			} : null;	
			
			var cellPath = '//td[@class="mn_partienoticesynthetique"]';
			var spanPath = './/span';
			var cells = doc.evaluate(cellPath, doc, nsResolver, XPathResult.ANY_TYPE, null);
			var cell = undefined;
			var regexLink = /\s*window.location='([^']+)'\s*/;
			
			//Cell loop
			while(cell = cells.iterateNext()) {
				//Get link
				var link = cell.attributes.item("onclick").textContent;
				var url = baseUri + regexLink.exec(link)[1];
				//Get title
				var title = "";
				var span = undefined;
				var spans = doc.evaluate(spanPath, cell, nsResolver, XPathResult.ANY_TYPE, null);
				//Span loop
				while(span = spans.iterateNext()) {
					if(title.length > 0) {
						title += " – ";
				}
					title += Zotero.Utilities.trim(span.textContent);
				}
				items[url] = title;
			}
			
			items = Zotero.selectItems(items);
			
			for(var i in items) {
				urls.push(reformURL(i));
			}

		}
		//Single result 
		else {
			urls.push(reformURL(doc.location.href));
		}
		

		return urls;        
	};

	
	
	this.extractMarcFields = function(doc) {
		var fields = new Array();

		var namespace = doc.documentElement.namespaceURI;
		var nsResolver = namespace ? function(prefix) {
			if (prefix == 'x') return namespace; else return null;
		} : null;
		
		/* Get table cell containing MARC code. */
		var elmts = doc.evaluate('//td[@class="texteNotice"]/text()',
	            doc, nsResolver, XPathResult.ANY_TYPE, null);
		/* Line loop. */
		var elmt, tag, content;
		var ind = "";

		while(elmt = elmts.iterateNext()) {
			var line = Zotero.Utilities.superCleanString(elmt.nodeValue);
			if(line.length == 0) {
				continue;
			}
			line = line.replace(/[_\t\xA0]/g," "); // nbsp
			tag = line.substr(0, 3);
			//ˆxxx‰ marks title parts skipped for sorting purposes. Ignore this
			content = line.substr(3).replace(/ˆ([^‰]+)‰/g, "$1");
			fields.push({tag: tag, value: content});
		}
		return fields;
	};
	
}();


/* Translator API implementation. */

function detectWeb(doc, url) {
	var resultRegexp = /ID=[0-9]+/i;
	//Single result ?
	if(resultRegexp.test(url)) {
		var type = Bnf.getDCType(doc, url);
		return Bnf.translateDCType(type);
	} 
    //Muliple result ?
	else if(Bnf.getResultsTable(doc)) {
		return "multiple";
	}
	//No items 
	return undefined;
}


function doWeb(doc, url) {
	//Get URIs
	var uris = Bnf.extractMarcUrls(doc);
	if(0 == uris.length) {
		return true;
	}
	
	//Load MARC2
	Bnf.loadMarcTranslator();
	var importer = Bnf.Marc.IO.getImporter();
	
	//Marc document loop
	Zotero.Utilities.processDocuments(uris, function(newDoc) {
		var fields = Bnf.extractMarcFields(newDoc);
		Zotero.debug(fields);
		if(fields && fields.length > 0) {
			//Build record
			var record = importer.parseFields(fields, record);
			
			//Translate record
			var importConverter = Bnf.Marc.Converters.getImportConverter(record);
			var item = importConverter.convert(record);
			
			//Postprocess item
			Bnf.postprocessItem(item, record, newDoc);
			
			item.complete();
		}
	}, function() { Zotero.done() }, null);
	
	Zotero.wait();
}
