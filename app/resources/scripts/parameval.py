import sys
import json
import math
import re
import collections

import pyfyparser

def clog2(val):
    return int(math.ceil(math.log(val)/math.log(2)))


evalIn = json.load(sys.stdin)

# Eval start
paramList = evalIn['paramList']

if not evalIn['context']:
    evalIn['context'] = {}

paramContext = evalIn['context']
paramContext['clog2'] = clog2

hashFind = dict()

# Build hashlist for finding parameter by name

for val in paramList:
    hashFind[val["name"]] = val
    val["refCount"] = 0
    val["outEdge"] = list()

# Replace value string for eval and add connections
for val in paramList:
    for nstr, nval in hashFind.items():
        # Search for param, use regex to avoid false match (partial overlapped name)
        searchEx = re.compile('(?:[^\\w]|^){}(?=[^\\w]|$)'.format(nstr))
        if re.search(searchEx, val['value']):
            # Param reference found
            val["refCount"] += 1
            nval['outEdge'].append(val)
            
# BFS to solve all parameters
bfsQueue = collections.deque()

for val in paramList:
    if val['refCount'] == 0:
        bfsQueue.append(val)

while bfsQueue:
    qfront = bfsQueue.popleft()
    # Hopefully no other functions required
    evalstr = qfront['value'].replace('$clog2', 'clog2')
    pyevalstr = pyfyparser.parseExpr(evalstr)
	
    resval = eval(pyevalstr, {"__builtins__": None}, paramContext)
    paramContext[qfront['name']] = resval
    qfront['solveValue'] = resval

    for nnode in qfront['outEdge']:
        nnode['refCount'] -= 1;
        if nnode['refCount'] == 0:
            bfsQueue.append(nnode)

# Clear intermediate variables for clean json dump
del paramContext['clog2']

for val in paramList:
    del val['refCount']
    del val['outEdge']

print(json.dumps(evalIn, indent=4, sort_keys=True))
