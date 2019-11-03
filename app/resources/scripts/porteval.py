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
portDesc = evalIn['portDesc']

if not evalIn['context']:
    evalIn['context'] = {}

paramContext = evalIn['context']
paramContext['clog2'] = clog2

for port in portDesc:
    # Use regex to split port descriptor into two halves
    # Fails at ?(?:):, will be fixed in custom parser
    matchres = re.search(r'\[((?:[^\?]|\?[^:]*?:)*?):(.*?)\]', port)
    if matchres:
        expLeft, expRight = matchres.groups()
        
        evalstr = expLeft.replace('$clog2', 'clog2')
        pyevalstr = pyfyparser.parseExpr(evalstr)
        valLeft = eval(pyevalstr, {"__builtins__": None}, paramContext)

        evalstr = expRight.replace('$clog2', 'clog2')
        pyevalstr = pyfyparser.parseExpr(evalstr)
        valRight = eval(pyevalstr, {"__builtins__": None}, paramContext)

        portDesc[port] = abs(int(valLeft) - int(valRight)) + 1


print(json.dumps(evalIn['portDesc'], indent=4, sort_keys=True))
