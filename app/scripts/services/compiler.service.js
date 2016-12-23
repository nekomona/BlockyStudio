'use strict';

angular.module('icestudio')
  .service('compiler', function(nodeSha1,
                                _package) {

    this.generate = function(target, project) {
      var code = '';
      switch(target) {
        case 'verilog':
          code += header('//');
          code += '`default_nettype none\n';
          code += verilogCompiler('main', project);
          break;
        case 'pcf':
          code += header('#');
          code += pcfCompiler(project);
          break;
        case 'testbench':
          code += header('//');
          code += testbenchCompiler(project);
          break;
        case 'gtkwave':
          code += header('[*]');
          code += gtkwaveCompiler(project);
          break;
        default:
          code += '';
      }
      return code;
    };

    function header(comment) {
      var header = '';
      var date = new Date();
      header += comment + ' Code generated by Icestudio ' + _package.version + '\n';
      header += comment + ' ' + date.toUTCString() + '\n';
      header += '\n';
      return header;
    }

    function digestId(id) {
      if (id.indexOf('-') !== -1) {
         return 'v' + nodeSha1(id).toString().substring(0, 6);
       }
       else {
         return id.replace(/\./g, '_');
       }
    }

    function module(data) {
      var code = '';
      if (data && data.name && data.ports) {

        // Header

        code += '\nmodule ' + data.name;

        //-- Parameters

        var params = [];
        for (var p in data.params) {
          if (data.params[p] instanceof Object) {
            params.push(' parameter ' + data.params[p].name + ' = ' + (data.params[p].value ? data.params[p].value : '0'));
          }
        }

        if (params.length > 0) {
          code += ' #(\n';
          code += params.join(',\n');
          code += '\n)';
        }

        //-- Ports

        var ports = [];
        for (var i in data.ports.in) {
          var _in = data.ports.in[i];
          ports.push(' input ' + (_in.range ? (_in.range + ' ') : '') + _in.name);
        }
        for (var o in data.ports.out) {
          var _out = data.ports.out[o];
          ports.push(' output ' + (_out.range ? (_out.range + ' ') : '') + _out.name);
        }

        if (ports.length > 0) {
          code += ' (\n';
          code += ports.join(',\n');
          code += '\n)';
        }

        code += ';\n';

        // Content

        if (data.content) {

          var content = data.content.split('\n');

          content.forEach(function (element, index, array) {
            array[index] = ' ' + element;
          });

          code += content.join('\n');
        }

        // Footer

        code += '\nendmodule\n';
      }

      return code;
    }

    function getParams(project) {
      var params = [];
      var graph = project.design.graph;

      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.constant') {
          params.push({
            name: digestId(block.id),
            value: block.data.value
          });
        }
      }

      return params;
    }

    function getPorts(project) {
      var ports = {
        in: [],
        out: []
      };
      var graph = project.design.graph;

      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.input') {
          ports.in.push({
            name: digestId(block.id),
            range: block.data.range ? block.data.range : ''
          });
        }
        else if (block.type === 'basic.output') {
          ports.out.push({
            name: digestId(block.id),
            range: block.data.range ? block.data.range : ''
          });
        }
      }

      return ports;
    }

    function getContent(name, project) {
      var i, j, w;
      var content = [];
      var graph = project.design.graph;
      var connections = {
        localparam: [],
        wire: [],
        assign: []
      };

      for (w in graph.wires) {
        var wire = graph.wires[w];
        if (wire.source.port === 'constant-out') {
          // Local Parameters
          var constantBlock = findBlock(wire.source.block, graph);
          var paramValue = digestId(constantBlock.id);
          if (paramValue) {
            connections.localparam.push('localparam p' + w + ' = ' + paramValue  + ';');
          }
        }
        else {
          // Wires
          var range = wire.size ? ' [0:' + (wire.size-1) +'] ' : ' ';
          connections.wire.push('wire' + range + 'w' + w + ';');
        }
        // Assignations
        for (i in graph.blocks) {
          var block = graph.blocks[i];
          if (block.type === 'basic.input') {
            if (wire.source.block === block.id) {
              connections.assign.push('assign w' + w + ' = ' + digestId(block.id) + ';');
            }
          }
          else if (block.type === 'basic.output') {
            if (wire.target.block === block.id) {
              if (wire.source.port === 'constant-out') {
                // connections.assign.push('assign ' + digestId(block.id) + ' = p' + w + ';');
              }
              else {
                connections.assign.push('assign ' + digestId(block.id) + ' = w' + w + ';');
              }
            }
          }
        }
      }

      content = content.concat(connections.localparam);
      content = content.concat(connections.wire);
      content = content.concat(connections.assign);

      // Wires Connections

      var numWires = graph.wires.length;
      for (i = 1; i < numWires; i++) {
        for (j = 0; j < i; j++) {
          var wi = graph.wires[i];
          var wj = graph.wires[j];
          if (wi.source.block === wj.source.block &&
              wi.source.port === wj.source.port &&
              wi.source.port !== 'constant-out') {
            content.push('assign w' + i + ' = w' + j + ';');
          }
        }
      }

      // Block instances

      content = content.concat(getInstances(name, project.design.graph));

      return content.join('\n');
    }

    function getInstances(name, graph) {
      var w, wire;
      var instances = [];
      var blocks = graph.blocks;

      for (var b in blocks) {
        var instance = '';
        var block = blocks[b];

        if (block.type !== 'basic.input' &&
            block.type !== 'basic.output' &&
            block.type !== 'basic.constant' &&
            block.type !== 'basic.info') {

          // Header
          instance += name;
          if (block.type === 'basic.code') {
            instance += '_' + digestId(block.id);
          }
          else {
            instance += '_' + digestId(block.type);
          }

          //-- Parameters

          var params = [];
          for (w in graph.wires) {
            wire = graph.wires[w];
            if ((block.id === wire.target.block) &&
                (wire.source.port === 'constant-out')) {
              var paramName = digestId(wire.target.port);
              var param = '';
              param += ' .' + paramName;
              param += '(p' + w + ')';
              params.push(param);
            }
          }

          if (params.length > 0) {
            instance += ' #(\n' + params.join(',\n') + '\n)';
          }

          //-- Instance name

          instance += ' ' +  digestId(block.id);

          //-- Ports

          var ports = [];
          var portsNames = [];
          for (w in graph.wires) {
            var portName = '';
            var isConstant = false;
            wire = graph.wires[w];
            if (block.id === wire.source.block) {
              portName = digestId(wire.source.port);
            }
            else if (block.id === wire.target.block) {
              portName = digestId(wire.target.port);
              isConstant = wire.source.port === 'constant-out';
            }
            if (portName && !isConstant &&
                portsNames.indexOf(portName) === -1) {
              portsNames.push(portName);
              var port = '';
              port += ' .' + portName;
              port += '(w' + w + ')';
              ports.push(port);
            }
          }

          instance += ' (\n' + ports.join(',\n') + '\n);';
        }

        if (instance) {
          instances.push(instance);
        }
      }
      return instances;
    }

    function findBlock(id, graph) {
      for (var b in graph.blocks) {
        if (graph.blocks[b].id === id) {
          return graph.blocks[b];
        }
      }
      return null;
    }

    function verilogCompiler(name, project) {
      var data;
      var code = '';

      if (project &&
          project.design &&
          project.design.graph) {

        var graph = project.design.graph;
        var deps = project.design.deps;

        // Main module

        if (name) {
          data = {
            name: name,
            params: getParams(project),
            ports: getPorts(project),
            content: getContent(name, project)
          };
          code += module(data);
        }

        // Dependencies modules

        for (var d in deps) {
          code += verilogCompiler(name + '_' + digestId(d), deps[d]);
        }

        // Code modules

        for (var i in graph.blocks) {
          var block = graph.blocks[i];
          if (block) {
            if (block.type === 'basic.code') {
              data = {
                name: name + '_' + digestId(block.id),
                params: block.data.params,
                ports: block.data.ports,
                content: block.data.code
              };
              code += module(data);
            }
          }
        }
      }

      return code;
    }

    function pcfCompiler(project) {
      var code = '';
      var graph = project.design.graph;

      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.input' ||
            block.type === 'basic.output') {

          if (block.data.pins.length > 1) {
            for (var p in block.data.pins) {
              var pin = block.data.pins[p];
              code += 'set_io ';
              code += digestId(block.id);
              code += '[' + pin.index + '] ';
              code += block.data.virtual ? '' : pin.value;
              code += '\n';
            }
          }
          else {
            code += 'set_io ';
            code += digestId(block.id);
            code += ' ';
            code += block.data.virtual ? '' : block.data.pins[0].value;
            code += '\n';
          }
        }
      }

      return code;
    }

    function testbenchCompiler(project) {
      var i, o, p;
      var code = '';

      code += '// Testbench template\n\n';

      code += '`default_nettype none\n';
      code += '`define DUMPSTR(x) `"x.vcd`"\n';
      code += '`timescale 10 ns / 1 ns\n\n';

      var ports = { in: [], out: [] };
      var content = '\n';

      content += '// Simulation time: 100ns (10 * 10ns)\n';
      content += 'parameter DURATION = 10;\n';

      // Parameters
      var _params = [];
      var params = mainParams(project);
      if (params.length > 0) {
        content += '\n// TODO: edit the module parameters here\n';
        content += '// e.g. localparam constant_value = 1;\n';
        for (p in params) {
          content += 'localparam ' + params[p].name + ' = ' + params[p].value + ';\n';
          _params.push(' .' + params[p].id + '(' + params[p].name + ')');
        }
      }

      // Input/Output
      var io = mainIO(project);
      var input = io.input;
      var output = io.output;
      content += '\n// Input/Output\n';
      var _ports = [];
      for (i in input) {
        content += 'reg ' + (input[i].range ? input[i].range + ' ': '') + input[i].name + ';\n';
        _ports.push(' .' + input[i].id + '(' + input[i].name + ')');
      }
      for (o in output) {
        content += 'wire ' + (output[o].range ? output[o].range + ' ': '') + output[o].name + ';\n';
        _ports.push(' .' + output[o].id + '(' + output[o].name + ')');
      }

      // Module instance
      content += '\n// Module instance\n';
      content += 'main';

      //-- Parameters
      if (_params.length > 0) {
        content += ' #(\n';
        content += _params.join(',\n');
        content += '\n)';
      }

      content += ' MAIN';

      //-- Ports
      if (_ports.length > 0) {
        content += ' (\n';
        content += _ports.join(',\n');
        content += '\n)';
      }

      content += ';\n';

      // Clock signal
      var hasClk = false;
      for (i in input) {
        if (input[i].name.toLowerCase() === 'input_clk') {
          hasClk = true;
          break;
        }
      }
      if (hasClk) {
        content += '\n// Clock signal\n';
        content += 'always #0.5 input_clk = ~input_clk;\n';
      }

      content += '\ninitial begin\n';
      content += ' // File were to store the simulation results\n';
      content += ' $dumpfile(`DUMPSTR(`VCD_OUTPUT));\n';
      content += ' $dumpvars(0, main_tb);\n\n';
      content += ' // TODO: initialize the registers here\n';
      content += ' // e.g. input_value = 1;\n';
      content += ' // e.g. #2 input_value = 0;\n';
      for (i in input) {
        content += ' ' + input[i].name + ' = 0;\n';
      }
      content += '\n';
      content += ' #(DURATION) $display("End of simulation");\n';
      content += ' $finish;\n';
      content += 'end\n';

      var data = {
        name: 'main_tb',
        ports: ports,
        content: content
      };
      code += module(data);

      return code;
    }

    function gtkwaveCompiler(project) {
      var code = '';

      var io = mainIO(project);
      var input = io.input;
      var output = io.output;

      for (var i in input) {
        code += 'main_tb.' + input[i].name + (input[i].range ? input[i].range: '') + '\n';
      }
      for (var o in output) {
        code += 'main_tb.' + output[o].name + (output[o].range ? output[o].range: '') + '\n';
      }

      return code;
    }

    function mainIO(project) {
      var input = [];
      var output = [];
      var inputUnnamed = 0;
      var outputUnnamed = 0;
      var graph = project.design.graph;
      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.input') {
          if (block.data.name) {
            input.push({
              id: digestId(block.id),
              name: 'input_' + block.data.name,
              range: block.data.range
            });
          }
          else {
            input.push({
              id: digestId(block.id),
              name: 'input_' + inputUnnamed.toString(),
            });
            inputUnnamed += 1;
          }
        }
        else if (block.type === 'basic.output') {
          if (block.data.name) {
            output.push({
              id: digestId(block.id),
              name: 'output_' + block.data.name,
              range: block.data.range
            });
          }
          else {
            output.push({
              id: digestId(block.id),
              name: 'output_' + outputUnnamed.toString()
            });
            outputUnnamed += 1;
          }
        }
      }

      return {
        input: input,
        output: output
      };
    }

    function mainParams(project) {
      var params = [];
      var paramsUnnamed = 0;
      var graph = project.design.graph;
      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.constant') {
          if (!block.data.local) {
            if (block.data.name) {
              params.push({
                id: digestId(block.id),
                name: 'constant_' + block.data.name,
                value: block.data.value
              });
            }
            else {
              params.push({
                id: digestId(block.id),
                name: 'constant_' + paramsUnnamed.toString(),
                value: block.data.value
              });
              paramsUnnamed += 1;
            }
          }
        }
      }

      return params;
    }

  });
