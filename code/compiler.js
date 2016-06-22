/**
 * @author Jesús Arroyo Torrens <jesus.jkhlg@gmail.com>
 *
 * June 2016
 */

 'use strict';

var sha1 = require('sha1');

function digestId(id) {
  if (id.indexOf('-') != -1) {
    return sha1(id).toString().substring(0, 6);
  }
  return id;
}
/*
      // Blocks

}

function findDependencies(data, blocks) {
  var deps = [];

  if (data.code && data.code.type == 'graph') {
    var graph = data.code.data;
    for (var n in graph.blocks) {
      var type = graph.blocks[n].type;
      if (deps.indexOf(type) == -1) {
        deps.push(type);
      }
      var category = type.split('.')[0];
      var key = type.split('.')[1];
      var retdeps = findDependencies(blocks[category][key], blocks);
      for (var i in retdeps) {
        if (deps.indexOf(retdeps[i]) == -1) {
          deps.push(retdeps[i]);
        }
      }
    }
  }
  return deps;
}
*/

function module(data) {
  var code = '';

  if (data &&
      data.name &&
      data.ports &&
      data.content) {

    // Header

    code += 'module ';
    code += data.name;
    code += ' (';

    data.ports.in.forEach(function (element, index, array) {
      array[index] = 'input ' + element;
    });
    data.ports.out.forEach(function (element, index, array) {
      array[index] = 'output ' + element;
    });

    var params = [];

    if (data.ports.in.length > 0) {
      params.push(data.ports.in.join(', '));
    }
    if (data.ports.out.length > 0) {
      params.push(data.ports.out.join(', '));
    }

    code += params.join(', ');

    code += ');\n';

    // Content

    var content = data.content.replace('\n\n', '\n').split('\n');

    content.forEach(function (element, index, array) {
      array[index] = ' ' + element;
    });

    code += content.join('\n');

    // Footer

    code += '\nendmodule\n';
  }

  return code;
}

function getPorts(name, project) {
  var ports = {
    in: [],
    out: []
  };
  var graph = project.graph;

  for (var i in graph.blocks) {
    var block = graph.blocks[i];
    if (block.type == 'basic.input') {
      ports.in.push(name + '_' + digestId(block.id));
    }
    else if (block.type == 'basic.output') {
      ports.out.push(name + '_' + digestId(block.id));
    }
  }

  return ports;
}

function getContent(name, project) {
  var content = '';
  var graph = project.graph;

  // Wires

  for (var w in graph.wires) {
    content += 'wire w' + w + ';\n'
  }

  // Connections

  for (var w in graph.wires) {
    var wire = graph.wires[w];
    for (var i in graph.blocks) {
      var block = graph.blocks[i];
      if (block.type == 'basic.input') {
        if (wire.source.block == block.id) {
          content += 'assign w' + w + ' = ' + name + '_' + digestId(block.id) + ';\n';
        }
      }
      else if (block.type == 'basic.output') {
        if (wire.target.block == block.id) {
          content += 'assign ' + name + '_' + digestId(block.id) + ' = w' + w + ';\n';
        }
      }
    }
  }

  // Block instances
  for (var b in graph.blocks) {
    var block = graph.blocks[b];
    if (block.type != 'basic.input' && block.type != 'basic.output') {
      content += name + '_' + digestId(block.id) + ' ' + digestId(block.id) + ' (\n';

      // Parameters
      var params = [];
      for (var w in graph.wires) {
        var param = '';
        var wire = graph.wires[w];
        if (block.id == wire.source.block) {
          param += '  .' + digestId(wire.source.port);
          param += '(w' + w + ')';
          params.push(param);
        }
        if (block.id == wire.target.block) {
          param += '   .' + digestId(wire.target.port);
          param += '(w' + w + ')';
          params.push(param);
        }
      }

      content += params.join(',\n');
      content += '\n);';
    }
  }

  return content;
}

function compiler(name, project) {
  var code = '';

  if (project &&
      project.board &&
      project.graph) {

    // Code modules

    for (var i in project.graph.blocks) {
      var block = project.graph.blocks[i];
      if (block.type == 'basic.code') {
        var data = {
          name: name + '_' + digestId(block.id),
          ports: block.data.ports,
          content: block.data.code
        }
        code += module(data);
        code += '\n';
      }
    }

    // TODO: Dependencies modules

    // Main module
    var data = {
      name: name + '_main',
      ports: getPorts(name, project),
      content: getContent(name, project)
    };
    code += module(data);
  }

  return code;
}


// Examples

var fs = require('fs');

function compare_string(s1, s2) {
  var diff = [];
  var string1 = s1.split(" ");
  var string2 = s2.split(" ");
  var size = Math.max(s1.length, s2.length);

  for(var x = 0; x < size; x++) {
    if(string1[x] != string2[x]) {
      diff.push(string1[x]);
    }
  }

  return diff.join(' ');
}

function test_example (name) {
  var filename = '../examples/' + name;
  fs.readFile(filename + '.v', 'utf8', function (err, data) {
    if (err) throw err;

    var example = require(filename + '.json');
    var s1 = compiler(name, example).replace(/[\r\n]/g, "");
    var s2 = data.replace(/[\r\n]/g, "");

    process.stdout.write('Testing ' + name + ' ...');
    if (s1 == s2) {
      process.stdout.write(' [OK]\n');
    }
    else {
      process.stdout.write(' [Fail]\n');
      process.stdout.write(compare_string(s1, s2) + '\n');
    }
  });
}

// Test examples
test_example('example1');
/*test_example('example2');
test_example('example3');
test_example('example4');
test_example('example5');
test_example('example6');*/

//console.log(compiler('example1', require('../examples/example1.json')));