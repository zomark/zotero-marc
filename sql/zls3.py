#!/usr/bin/python

import os,sys
import sqlite3
from configparser import ConfigParser
#from urllib import URLopener
import urllib.request, urllib.parse, urllib.error
import codecs
import re

IANA = "http://www.iana.org/assignments/language-subtag-registry"
ISO = "http://www.loc.gov/standards/iso639-2/ISO-639-2_utf-8.txt"
SCRIPTS = "http://www.unicode.org/Public/UNIDATA/Scripts.txt"

keynames = ['subtag', 'tag', 'type', 'suppressscript', 'scope', 'preferredvalue', 'macrolanguage', 'add', 'description', 'deprecated', 'comment', 'prefix'];

header = '''-- %s

-- This file is derived from the IANA Language Subtag Registry

DROP TABLE IF EXISTS zlsSubtagData;
DROP TABLE IF EXISTS zlsSubtags;
DROP TABLE IF EXISTS isoTagMap;
DROP TABLE IF EXISTS unicodeScriptMap;

'''

zlsSubtagData = '''
CREATE TABLE zlsSubtagData (
	id INTEGER PRIMARY KEY,
	value TEXT
);
'''

zlsSubtags = '''
CREATE TABLE zlsSubtags (
	seq INTEGER PRIMARY KEY,
	subtag INT,
	tag INT,
	type INT,
	suppressscript INT,
	scope INT,
	preferredvalue INT,
	macrolanguage INT,
	added INT,
	description INT,
	deprecated INT,
	comment INT,
	prefix INT
);
'''

isoTagMap = '''
CREATE TABLE isoTagMap (
	iso TEXT PRIMARY KEY,
	iana TEXT
);
'''

unicodeScriptMap = '''
CREATE TABLE unicodeScriptMap (fromCode INT PRIMARY KEY, 
	toCode INT, 
	script TEXT
);
'''

unicodeScriptMapIndex = '''
CREATE INDEX unicodeScriptMap_toCode ON unicodeScriptMap(toCode);
'''

class Database:

	def __init__(self):
		self.db = sqlite3.connect(':memory:')
		self.db.execute(zlsSubtagData) 
		self.db.execute(zlsSubtags) 
		self.db.execute(isoTagMap)
		self.db.execute(unicodeScriptMap)
		self.count = 0
		self.seq = 0
		self.anyValToId = {}
		self.keyToId = {}
		self.descrToScript = {}


	def processEntry(self,tagDataSet):
		for label in tagDataSet:
			for strval in [label, tagDataSet[label]]:
				if type(strval) == type([]):
					for mystrval in strval:
						if mystrval not in self.anyValToId:
							self.count += 1
							self.anyValToId[mystrval] = self.count
							self.db.execute("INSERT INTO zlsSubtagData VALUES (?,?)", (self.count,mystrval))
				else:
					if strval not in self.anyValToId:
						self.count += 1
						self.anyValToId[strval] = self.count
						self.db.execute("INSERT INTO zlsSubtagData VALUES (?,?)", (self.count,strval))

		self.seq += 1
		insertvals = [self.seq]
		prefixcount = 0
		for keyname in keynames:
			if keyname not in tagDataSet:
				insertvals.append(None)
				if keyname == 'prefix':
					self.db.execute("INSERT INTO zlsSubtags VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?);", insertvals);
			elif keyname == 'prefix':
				for item in tagDataSet['prefix']:
					insertvals.append(self.anyValToId[tagDataSet[keyname][prefixcount]])
					self.db.execute("INSERT INTO zlsSubtags VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?);", insertvals);
					prefixcount += 1
					self.seq += 1
					insertvals[0] = self.seq
					insertvals.pop()
			else:
				insertvals.append(self.anyValToId[tagDataSet[keyname]])
		if(tagDataSet["type"] == "script" and tagDataSet["description"] and tagDataSet["subtag"]):
			self.descrToScript[tagDataSet["description"].lower()] = tagDataSet["subtag"]

class Build(Database):

	def __init__(self):
		Database.__init__(self)
		spath = os.getcwd()
		sname = os.path.splitext(os.path.split(sys.argv[0])[-1])[0]
		# input = os.path.join(spath, "%s.txt" % (sname,))
		self.dumpfile = os.path.join(spath, "%s.sql" % (sname,))

		#if not os.path.exists(input):
		#	print "\nUsage: %s.py" % sname
		#	print "\n  A file %s.txt should be located in the same directory as" %sname
		#	print "  the script, and should be a copy of the IANA Language"
		#	print "  Subtag registry."
		#	print "\n  Output will be placed in %s.sql\n" % sname
		#	sys.exit()

		self.load_iso()
		self.load_iana()
		self.load_scripts()
		#Write SQL
		with open(self.dumpfile, 'wb') as f:
			f.write((header % self.filedate).encode("utf8"));
			for line in self.db.iterdump():
				if line.startswith('BEGIN'):
					continue
				if line.startswith('COMMIT'):
					continue
				f.write(("%s\n" % line).encode('utf8'))
				
	def load_iso(self):
		ifh = urllib.request.urlopen(ISO)
		sql = 'INSERT INTO isoTagMap VALUES (?,?)'
		while 1:
			line = ifh.readline()
			if not line: break
			if line.startswith(codecs.BOM_UTF8):
				line = line[3:]
			line = line.decode("utf8")
			line = line.split("|")
			if line[2]:
				self.db.execute(sql, [line[0], line[2]])
				if line[1]:
					self.db.execute(sql, [line[1], line[2]])

	def load_iana(self):
		ifh = urllib.request.urlopen(IANA)
		tagDataSet = {}
		skip = False
		while 1:
			line = ifh.readline()
			if not line: break
			line = line.decode('utf8').rstrip()
			pos = line.find(":")
			if pos > -1 and line[:pos].find(" ") == -1:
				key = line[:pos].lower().replace('-','')
				val = line[pos+1:].strip()
				if key == 'filedate':
					self.filedate = val.replace('-','')
					# This can go away after the next IANA update
					if self.filedate == '20100817':
						self.filedate = '20100821'
					skip = True
					continue
				if key == 'prefix':
					if 'prefix' not in tagDataSet:
						tagDataSet['prefix'] = []
					tagDataSet['prefix'].append(val)
				else:
					#First key wins! (multiple descriptions)
					if key not in tagDataSet:
						tagDataSet[key] = val
			elif line[0] == " ":
				tagDataSet[key] += " %s" % (line,)
			elif line == "%%":
				if skip:
					skip = False
					continue
				self.processEntry(tagDataSet)
				tagDataSet = {}
		self.processEntry(tagDataSet)


	def load_scripts(self):
		#Read raw data, get relevant lines into array of [start, end, script] items
		reRange = re.compile("""^([A-Fa-f0-9]+)(?:\.\.([A-Fa-f0-9]+))?\s*;\s*(\w+)""");
		ifh = urllib.request.urlopen(SCRIPTS)
		items = []
		while 1:
			line = ifh.readline()
			if not line: break
			if line.startswith(codecs.BOM_UTF8):
				line = line[3:]
			line = line.decode("utf8")
			match = reRange.search(line)
			if match:
				start = int(match.group(1), 16)
				end = start
				if match.group(2):
					end = int(match.group(2), 16)
				script = match.group(3).replace("_", " ")
				items.append([start, end, script])
		#Sort by start index
		items.sort(key=lambda item: item[0])
		currentScript = None
		currentStart = -1
		currentEnd = -1
		#Collapse ranges and delete Common/Inherited
		collapsedItems = []
		for item in items:
			if item[2] != currentScript:
				if currentStart >= 0:
					if currentScript != "Common" and currentScript != "Inherited":
						collapsedItems.append([currentStart, currentEnd, currentScript])
				currentStart = item[0]
				currentScript = item[2]
			currentEnd = item[1]
		if currentStart >= 0:
			if currentScript != "Common" and currentScript != "Inherited":
				collapsedItems.append([currentStart, currentEnd, currentScript])
		#Resolve descriptions to subtags
		#Fixes for IANA/Unicode mismatches
		self.descrToScript["old italic"] = "Ital"
		self.descrToScript["georgian"] = "Geor"
		self.descrToScript["canadian aboriginal"] = "Cans"
		self.descrToScript["phags pa"] = "Phag"
		self.descrToScript["meetei mayek"] = "Mtai"
		self.descrToScript["cuneiform"] = "Xsux"
		self.descrToScript["nko"] = "Nkoo"
		for item in collapsedItems:
			descr = item[2].lower()
			if(descr in self.descrToScript):
				subtag = self.descrToScript[descr]
				self.db.execute("INSERT INTO unicodeScriptMap(fromCode, toCode, script) VALUES(?,?,?)",
					(item[0], item[1], subtag));
			else:
				print(descr.encode("utf8"), "=> NO MATCH")
			
			

	
		


if __name__ == '__main__':
	Build()
