import pyjsparser

def digestNode(node):
    nodetype = node['type']

    if nodetype == 'Program':
        return digestNode(node['body'])
    elif nodetype == 'Identifier':
        return node['name']
    elif nodetype == 'Literal':
        if type(node['value']) == unicode:
            return node['raw']
        else:
            return str(node['value'])
    elif nodetype == 'UnaryExpression' or nodetype == 'UpdateExpression':
        if node['prefix']:
            rstr = '({0}{1})'
        else:
            rstr = '({1}{0})'
        return rstr.format(node['operator'], digestNode(node['argument']))
    elif nodetype == 'BinaryExpression':
        return '({}{}{})'.format(digestNode(node['left']), node['operator'], digestNode(node['right']))
    elif nodetype == 'ConditionalExpression':
        return '({} if {} else {})'.format(digestNode(node['consequent']), digestNode(node['test']), digestNode(node['alternate']))
    elif nodetype == 'CallExpression':
        return '({}({}))'.format(digestNode(node['callee']), ','.join([digestNode(n) for n in node['arguments']]))
    else:
        raise Exception()

def parseExpr(exp):
    return digestNode(pyjsparser.parse(exp))
