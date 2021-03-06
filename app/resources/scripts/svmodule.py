import os
import re
import sys
import json


class ParserHelper(object):
    @staticmethod
    def isRange(strval):
        """Returns True if the string is a SystemVerilog range.
        """
        if re.search(r'\[.*\]', strval) is not None:
            return True
        else:
            return False

    @staticmethod
    def isInterface(strval):
        """Returns True if the strval describes an interface with a
        module port definition.
        """

        if len(strval) == 0:
            return False

        x = re.split(r' ', strval)[0]

        if x == ("input"):
            return False
        elif x == "output":
            return False
        elif x == "inout":
            return False
        elif x == "ref":
            return False
        else:
            return True

    @staticmethod
    def getArrays(strval):
        """Returns arrays range(s).
        """
        # add @ around ranges to split by space
        strval = re.sub(r'[ ]*\[', r'@[', strval)
        lval = re.split(r'@', strval)

        # iterates over lval to get each range
        strarrays = ''
        for l in lval:
            if ParserHelper.isRange(l):
                strarrays += l

        return strarrays

    @staticmethod
    def removeArrays(strval):
        """Returns a string without range(s).
        """
        # add @ around ranges to split by space
        strval = re.sub(r'[ ]*\[', r'@[', strval)
        lval = re.split(r'@', strval)

        if type(lval) is None:
            return ''

        return lval[0]

    @staticmethod
    def getNameAndType(strval):
        """Returns name and type of a string like:
             - "int [31:0] GEN [31:0]" =>
                   ('int [31:0]', 'GEN [31:0]')
             - "output logic name" =>
                   ('output logic', 'name')
             - "interface.slave name" =>
                   ('interface.slave', 'name')
         """
        x = re.split(' ', strval)

        pName = ''
        for i in range(len(x)):
            v = x.pop()
            if ParserHelper.isRange(v):
                pName = v + pName
            else:
                x.append(v)
                break

        if len(x) != 0:
            pName = x.pop() + pName

        if len(x) != 0:
            pType = ' '.join(x)
        else:
            pType = ''

        return pType, pName

    @staticmethod
    def removeMultiLineComments(strval):
        state = 0
        strnew = ''
        L = len(strval)

        for i in range(L):
            if i < (L-1):
                if strval[i] == '/' and strval[i+1] == '*':
                    state = 1

            if i > 1:
                if strval[i-2] == '*' and strval[i-1] == '/':
                    state = 0

            if state == 0:
                strnew += strval[i]
        return strnew


class Parser:
    def parseBlock(self, strval):
        i = 0
        k = 0

        condition = True

        while condition:
            if strval[i] == '(':
                k = k + 1
            elif strval[i] == ')':
                k = k - 1

            i = i + 1

            if k <= 0:
                condition = False

        return (strval[:i], strval[i:])

    def parseImportList(self):
        """Returns a list of import packages"""
        return []

    def parseParametersList(self):
        """Returns a list of dictionnaries with parameter type,
        name and value.
        """

        # get Parameter block without parenthesis
        x = self.parametersStr[1:-1]

        # remove parameter
        x = re.sub(r'[ ]*parameter[ ]*', r'', x)

        # protect comma in quotes
        in_quotes_re = re.compile('("[^"]+")')
        x = in_quotes_re.sub(lambda match: match.group().replace(",", "\x00"), x)

        # Split parameters list
        params = re.split(',', x)

        parametersList = []

        for p in params:
            # Restore comma in quotes
            x = re.sub("\x00", ",", p)

            # Extract param default value
            x = re.split('=', x)
            if len(x) > 1:
                pValue = x[1]
            else:
                pValue = ''

            x = x[0]

            # Extract type and name
            pType, pName = ParserHelper.getNameAndType(x)

            pPackedArrays = ParserHelper.getArrays(pType)
            pUnpackedArrays = ParserHelper.getArrays(pName)

            pType = ParserHelper.removeArrays(pType)
            pName = ParserHelper.removeArrays(pName)

            if pType == '' and pName == '' and pValue == '' and pPackedArrays == '':
                continue

            parametersList.append({'type':     pType,
                                   'name':     pName,
                                   'value':    pValue,
                                   'packed':   pPackedArrays})
                                 # unpacked array is only supported by SV
                                 # 'unpacked': pUnpackedArrays})

        return parametersList

    def parsePortsList(self):
        """Returns a list of dictionnaries with port direction,
        isInterface, packed array range(s), unpacked array range(s),
        type and name.
        """
        # get Parameter block without parenthesis
        x = self.portsStr[1:-1]

        ports = re.split(',', x)
        portsList = []
        pTypePrev = ''

        for p in ports:
            # Extract type and name
            pType, pName = ParserHelper.getNameAndType(p)

            # if pType is empty, it must be taken from the previous
            # port.
            if pType == '':
                pType = pTypePrev
            else:
                pTypePrev = pType

            pPackedArrays = ParserHelper.getArrays(pType)
            pUnpackedArrays = ParserHelper.getArrays(pName)

            pType = ParserHelper.removeArrays(pType)
            pName = ParserHelper.removeArrays(pName)

            if ParserHelper.isInterface(pType):
                pIsInterface = True
                # extract the identifier after the dot* (within
                # interface port type)
                pDir = re.sub(r'.*\.([a-zA-Z_][a-zA-Z_0-9]*).*',
                              r'\1',
                              pType)

                # remove the dot and the following indentifier
                pType = re.sub(r'(.*)\.[a-zA-Z_][a-zA-Z_0-9]*[ ]*(.*)',
                               r'\1 \2',
                               pType)

                pType = re.sub(r'[ ]*$', '', pType)

            else:
                pIsInterface = False
                # extract direction
                pDir = re.sub(r'([a-zA-Z_][a-zA-Z_0-9]*)[ ]*.*', r'\1', pType)
                # extract type
                pType = re.sub(r'[a-zA-Z_][a-zA-Z_0-9]*[ ]*(.*)', r'\1', pType)

            portsList.append({'interface': pIsInterface,
                              'type':      pType,
                              'direction': pDir,
                              'name':      pName,
                              'packed':    pPackedArrays})
                            # unpacked array is only supported by SV
                            # 'unpacked':  pUnpackedArrays})

        return portsList

    def updatePara(self, newpara):
        for para in self.parametersList:
            if newpara['name'] == para['name']:
                if newpara['type']:
                    para['type'] = newpara['type']
                if newpara['value']:
                    para['value'] = newpara['value']
                if newpara['packed']:
                    para['packed'] = newpara['packed']
                break
        else:
            self.parametersList.append(newpara)

            
    def updatePort(self, newport):
        for port in self.portsList:
            if newport['name'] == port['name']:
                if newport['type']:
                    port['type'] = newport['type']
                if newport['direction']:
                    port['direction'] = newport['direction']
                if newport['packed']:
                    port['packed'] = newport['packed']
                break
        else:
            self.portsList.append(newport)
            
    def __init__(self, moduleString):

        # break into modules 

        # remove everithing before module
        #x = re.sub(r'(^|.*[ ])module ', r'module ', moduleString)
        x = moduleString[moduleString.find('module '):]

        # spilit module into content and module declaration
        modend = x.find(');') 
        moddec = x[0:modend+2] # contains );
        modcont = x[modend+2:] # passing );

        # process module descriptor
        x = moddec
        
        # remove everithing after the end of the module declaration
        x = re.sub(r'\);.*$', r');', x)

        # prepare the string to be parsed
        x = re.sub(r'[ ]*=[ ]*', '=', x)
        x = re.sub(r'[ ]*\([ ]*', '(', x)
        x = re.sub(r'[ ]*\)[ ]*', ')', x)
        x = re.sub(r'[ ]*\[[ ]*', ' [', x)
        x = re.sub(r'[ ]*\][ ]*', '] ', x)
        x = re.sub(r'[ ]*,[ ]*', ',', x)
        x = re.sub(r'[ ]*;[ ]*', ';', x)
        x = re.sub(r'[ ]*\);', ');', x)
        x = re.sub(r'[ ]*\)\(', ')(', x)

        # parse moduleName
        searchres = re.search('(?<=module )[a-zA-Z_][a-zA-Z_0-9]*', x)
        self.moduleNameStr = searchres.group(0)

        # remove module + moduleName
        x = re.sub(r'module [a-zA-Z_][a-zA-Z_0-9]*[ ]*', '', x)

        # search and remove optional header import
        self.importList=[]
        searchres = re.search('(?<=import )[0-9a-zA-Z_,:\*]*', x)
        if searchres != None:
            self.importList=re.split(',',searchres.group(0))
            x = re.sub(r'import [0-9a-zA-Z_,:\*]*;','',x)

        # Check if there is parameters
        if x[0] == "#":
            # remove pound
            x = re.sub(r'#[ ]*', '', x)
            (self.parametersStr, x) = self.parseBlock(x)

        else:
            self.parametersStr = ''

        # Retreive ports list
        (self.portsStr, x) = self.parseBlock(x)

        # Check again if there is parameters
        if x[0] == "#" and self.parametersStr != '':
            # remove pound
            x = re.sub(r'#[ ]*', '', x)
            (self.parametersStr, x) = self.parseBlock(x)

        self.parametersList = self.parseParametersList()
        self.portsList = self.parsePortsList()

        # process port type in content
        c_para = re.findall(r'(?:\s|^)parameter\s*(integer|logic|bit)?\s*(\[.*?:.*?])?\s*([^;]+?);', modcont)

        for item in c_para:
            paratype = item[0]
            parasize = item[1]
            paras = item[2].split(',')
            for para in paras:
                pitem = re.match(r'\s*(\w*)\s*=?\s*(.*)?\s*', para)
                self.updatePara({'type':     paratype if paratype else 'integer',
                                 'name':     pitem.group(1),
                                 'value':    pitem.group(2),
                                 'packed':   parasize})

                
        c_para = re.findall(r'(?:\s|^)output\s*(wire|reg)?\s*(\[.*?:.*?])?\s*([^;]+?);', modcont)

        for item in c_para:
            paratype = item[0]
            parasize = item[1]
            paras = item[2].split(',')
            for para in paras:
                pitem = re.match(r'\s*(\w*)\s*=?\s*(.*)?\s*', para)
                self.updatePort({'interface': False,
                                 'type':      paratype,
                                 'name':      pitem.group(1),
                                 'direction': 'output',
                                 'packed':    parasize})

                
        c_para = re.findall(r'(?:\s|^)input\s*(wire)?\s*(\[.*?:.*?])?\s*([^;]+?);', modcont)

        for item in c_para:
            paratype = item[0]
            parasize = item[1]
            paras = item[2].split(',')
            for para in paras:
                pitem = re.match(r'\s*(\w*)\s*=?\s*(.*)?\s*', para)
                self.updatePort({'interface': False,
                                 'type':      paratype,
                                 'name':      pitem.group(1),
                                 'direction': 'input',
                                 'packed':    parasize})

                
        c_para = re.findall(r'(?:\s|^)inout\s*(wire)?\s*(\[.*?:.*?])?\s*([^;]+?);', modcont)

        for item in c_para:
            paratype = item[0]
            parasize = item[1]
            paras = item[2].split(',')
            for para in paras:
                pitem = re.match(r'\s*(\w*)\s*=?\s*(.*)?\s*', para)
                self.updatePort({'interface': False,
                                 'type':      paratype,
                                 'name':      pitem.group(1),
                                 'direction': 'inout',
                                 'packed':    parasize})
    
    def getModuleName(self):
        """Returns the module name.
        """
        return self.moduleNameStr

    def getParametersList(self):
        """Returns the parsed parameters list.
        """
        return self.parametersList

    def getPortsList(self):
        """Returns the parsed ports list.
        """
        return self.portsList

    def getImportList(self):
        """Returns the parsed import package list.
        """
        return self.importList

# new classes
def FileParser(filestr):
    modules = []

    # remove one line comments
    x = re.sub(r'//.*[\n\r]', r'', filestr)

    # remove preprocessor signs
    x = re.sub(r'`.*[\n\r]', r'', x)

    # flatten the string module
    x = re.sub(r'[ \n\r\t]+', r' ', x)

    # remove multiline comments
    # pattern = re.compile(r'//.*?$|/\*.*?\*/|\'(?:\\.|[^\\\'])*\'|"(?:\\.|[^\\"])*"',
    #                      re.DOTALL | re.MULTILINE)
    # x = re.sub(pattern, r'', x)
    x = ParserHelper.removeMultiLineComments(x)

    x = x.split('endmodule')[0:-1];

    return [Parser(m) for m in x]



if len(sys.argv) < 2:
    print('No valid filename')
    exit(1)

fpath = sys.argv[1]

with open(fpath, 'r') as fp:
    mod = FileParser(fp.read())

out_mod = []

for m in mod:
    out_mod.append({"name": m.getModuleName(),
                    "parameter": m.getParametersList(),
                    "port": m.getPortsList()
                    })

print(json.dumps(out_mod, indent=4, sort_keys=True))
