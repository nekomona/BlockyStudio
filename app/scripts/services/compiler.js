'use strict';

angular.module('icestudio')
  .service('compiler', function(common,
                                utils,
                                nodeSha1,
                                _package) {

    this.generate = function(target, project, opt) {
      var content = '';
      var files = [];
      switch(target) {
        case 'verilog':
          content += header('//', opt);
          // content += '`default_nettype none\n';
          content += verilogCompiler('main', project, opt);
          files.push({
            name: 'main.v',
            content: content
          });
          break;
        case 'ioconstr':
          var ext = common.selectedBoard.info.constraint || 'PCF';
          content += header('#', opt);
          content += ioConstraintCompiler(project, opt);
          files.push({
            name: 'io_cst.' + ext.toLowerCase(),
            content: content
          });
          break;
        case 'list':
          files = listCompiler(project);
          break;
        case 'testbench':
          content += header('//', opt);
          content += testbenchCompiler(project);
          files.push({
            name: 'main_tb.v',
            content: content
          });
          break;
        case 'gtkwave':
          content += header('[*]', opt);
          content += gtkwaveCompiler(project);
          files.push({
            name: 'main_tb.gtkw',
            content: content
          });
          break;
        default:
          break;
      }
      return files;
    };

    function assocIncludes(arr, val, normkey) {
      for (var key in arr) {
        if (normkey && normkey === key) continue;
        if (arr[key] === val) return key;
      }
      return null;
    }

    function getDependencyModuleName(d, project, nameList) {
      var moduleNames = nameList.moduleNames;
      var genname = '';
      if (project.package.name) {
        genname = project.package.name.replace(/[^\w]/g, '_');
        if(assocIncludes(moduleNames, genname, d)) {
          genname += '_' + utils.digestId(d);
        }
      } else {
        genname = utils.digestId(d);
      }
      moduleNames[d] = genname;
      return genname;
    }

    function getModuleName(name, block, i, nameList) {
      var moduleNames = nameList.moduleNames;
      if (moduleNames[name+block.id]) {
        // code blocks
        // attempt to fix issues about old icestudio cloned modules with same uuid for code block in different project
        return moduleNames[name+block.id];
      } else if (moduleNames[block.type]) {
        // dependencies blocks
        return moduleNames[block.type]
      } else {
        var genname = '';
        if (block.type === 'basic.code') {
          if (block.data.name) {
            genname = name + '_' + block.data.name;
            if (assocIncludes(moduleNames, genname, name+block.id)) {
              genname = name + '_code_' + block.data.name + i.toString();
            }
          } else {
            genname =  name + '_code_' + i.toString();
          }
          moduleNames[name+block.id] = genname;
        } else {
          genname = utils.digestId(block.type);
          moduleNames[block.type] = genname;
        }
        return genname;
      }
    }

    function getInstanceName(name, block, i, nameList) {
      var moduleNames = nameList.moduleNames;
      if (moduleNames[block.id]) {
        return 'u_' + moduleNames[block.id];
      } else if (moduleNames[block.type]) {
        return 'u_' + moduleNames[block.type] + '_' + i.toString();
      } else {
        return utils.digestId(block.id);
      }
    }

    function getPortName(name, block, i, nameList) {
      var portNames = nameList.portNames;

      if (!portNames[name]) {
        portNames[name] = new Array();
      }

      if (portNames[name][block.id]) {
        return portNames[name][block.id];
      } else if (block.type === 'basic.input' || block.type === 'basic.output' ||
                 block.type === 'basic.busInput' || block.type === 'basic.busOutput'
                 ) {
        var nname = '';
        if (block.data.name) {
          nname = block.data.name;
          if(assocIncludes(portNames[name], nname, block.id)) {
            nname += '_' + i.toString();
          }
        } else if(block.type === 'basic.input') {
          if (block.data.clock === true) {
            nname = 'clk_in_' + i.toString();
          } else {
            nname = 'in_' + i.toString();
          }
        } else if(block.type === 'basic.output') {
          nname = 'out_' + i.toString();
        } else if(block.type === 'basic.busInput') {
          nname = 'bus_slave_' +i.toString() + '_';
        } else if(block.type === 'basic.busOutput') {
          nname = 'bus_master_' +i.toString() + '_';
        } else {
          nname = utils.digestId(block.id);
        }
        portNames[name][block.id] = nname;
        return nname;
      } else {
        return '';
      }
    }

    function getParamName(name, block, i, nameList) {
      var paramNames = nameList.paramNames;

      if (!paramNames[name]) {
        paramNames[name] = new Array();
      }

      if (paramNames[name][block.id]) {
        return paramNames[name][block.id];
      } else if (block.type === 'basic.constant' || block.type === 'basic.memory') {
        var nname = '';
        if (block.data.name) {
          nname = block.data.name;
          if(assocIncludes(paramNames[name], nname, block.id)) {
            nname += '_' + i.toString();
          }
        } else {
          nname = 'param_' + i.toString();
        }
        paramNames[name][block.id] = nname;
        return nname;
      } else {
        return '';
      }
    }

    function CheckTypeIsBus(size) {
      return (typeof size !== 'undefined' && isNaN(size));
    }

    function header(comment, opt) {
      var header = '';
      var date = new Date();
      opt = opt || {};
      if (opt.header !== false) {
        header += comment + ' Code generated by Icestudio ' + _package.version + '\n';
        if (opt.datetime !== false) {
          header += comment + ' ' + date.toUTCString() + '\n';
        }
        header += '\n';
      }
      return header;
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

        if (params.length === 0 && ports.length === 0) {
          code += '\n';
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

    function getParams(name, project) {
      var params = [];
      var graph = project.design.graph;

      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.constant') {
          params.push({
            name: getParamName(name, block, i, project.nameList),
            value: block.data.value
          });
        }
        else if (block.type === 'basic.memory') {
          var name = getParamName(name, block, i, project.nameList);
          params.push({
            name: name,
            value: '"' + name + '.list"'
          });
        }
      }

      return params;
    }

    var lookupPortMonitorName = function(name, bustype) {
      var bus = common.bus[bustype];
      for (var pi in bus.ports) {
        var p = bus.ports[pi];
        if (name == p.name_master || name == p.name_slave || name == p.name_monitor) {
          return p.name_monitor
        }
      }
    }

    function getPorts(name, project) {
      var ports = {
        in: [],
        out: []
      };
      var graph = project.design.graph;

      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        var pname = getPortName(name, block, i, project.nameList);
        if (block.type === 'basic.input') {
          ports.in.push({
            name: pname,
            range: block.data.range ? block.data.range : ''
          });
        }
        else if (block.type === 'basic.output') {
          ports.out.push({
            name: pname,
            range: block.data.range ? block.data.range : ''
          });
        }
        else if (block.type === 'basic.busInput') {
          var bustype = block.data.type;
          var bus = common.bus[bustype];
          for (var pi in bus.ports) {
            var p = bus.ports[pi];
            if (p.source === 'master') {
              ports.in.push({
                name: pname + p.name_master,
                range: (p.size > 1) ? (['[', p.size-1, ':0]'].join('')) : '' 
              })
            } else {
              ports.out.push({
                name: pname + p.name_master,
                range: (p.size > 1) ? (['[', p.size-1, ':0]'].join('')) : '' 
              })
            }
          }
        }
        else if (block.type === 'basic.busOutput') {
          var bustype = block.data.type;
          var bus = common.bus[bustype];
          for (var pi in bus.ports) {
            var p = bus.ports[pi];
            if (p.source === 'slave') {
              ports.in.push({
                name: pname + p.name_slave,
                range: (p.size > 1) ? (['[', p.size-1, ':0]'].join('')) : '' 
              })
            } else {
              ports.out.push({
                name: pname + p.name_slave,
                range: (p.size > 1) ? (['[', p.size-1, ':0]'].join('')) : '' 
              })
            }
          }
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

      var wireSource = [];
        // We need to rearrange internal design specification to compile it
        // Convert virtual labels to wire and some stuff .

        var vwiresLut={};
        var lidx,widx, lin, vw;
        var twire;

        //Create virtual wires

        //First identify sources and targets and create a look up table to work easy with it
        if( typeof graph !== 'undefined' &&
            graph.blocks.length >0 &&
            graph.wires.length>0){

          for(lidx in graph.blocks){
            lin=graph.blocks[lidx];
            if( lin.type === 'basic.inputLabel' ){
              for(widx in graph.wires){
                vw=graph.wires[widx];
                if(vw.target.block === lin.id){
                  if(typeof vwiresLut[lin.data.name] === 'undefined'){
                      vwiresLut[lin.data.name]={source:[],target:[]};
                  }
                  twire=vw.source;
                  twire.size=vw.size;
                  vwiresLut[lin.data.name].source.push(twire);
                }
              }
            }
            if( lin.type === 'basic.outputLabel' ){
              for(widx in graph.wires){
                vw=graph.wires[widx];
                if(vw.source.block === lin.id){
                  if(typeof vwiresLut[lin.data.name] === 'undefined'){
                      vwiresLut[lin.data.name]={source:[],target:[]};
                  }

                  twire=vw.target;
                  twire.size=vw.size;
                  vwiresLut[lin.data.name].target.push(twire);
                }
              }
            }
            /*
            if( lin.type === 'basic.busInterface' ) {
              var busMasterId = '';
              var wireConnected = [];
              var bustype = lin.data.type;

              if( lin.data.direction === 'master' ) {
                busMasterId = lin.id;
              }
              for(widx in graph.wires){
                vw=graph.wires[widx];
                if(vw.size && isNaN(vw.size)) {
                  // Bus
                  if(vw.target.block === lin.id) {
                    busMasterId = vw.source.block;
                  }
                } else {
                  if(vw.source.block === lin.id ||
                    vw.target.block === lin.id) {
                      wireConnected.push(vw);
                  } 
                }
              }
              for(var vwi in wireConnected) {
                vw = wireConnected[vwi];
                if(vw.source.block === lin.id){
                  var vwireName = busMasterId + lookupPortMonitorName(vw.source.port, bustype);
                  if(typeof vwiresLut[vwireName] === 'undefined'){
                      vwiresLut[vwireName]={source:[],target:[]};
                  }

                  twire=vw.target;
                  twire.size=vw.size;
                  vwiresLut[vwireName].target.push(twire);
                }
                if(vw.target.block === lin.id){
                  var vwireName = busMasterId + lookupPortMonitorName(vw.target.port, bustype);
                  if(typeof vwiresLut[vwireName] === 'undefined'){
                      vwiresLut[vwireName]={source:[],target:[]};
                  }
                  twire=vw.source;
                  twire.size=vw.size;
                  vwiresLut[vwireName].source.push(twire);
                }
              }
            }
            */
          }//for lin
        }// if typeof....
        
        // Remove bus interface and replace it with virtual wires
        var procBusInterface = function (block, busname, bustype) {
          for(var vwi in graph.wires) {
            var vw = graph.wires[vwi];
            if(vw.source.block === block.id){
              var vwireName = busname + lookupPortMonitorName(vw.source.port, bustype);
              if(typeof vwiresLut[vwireName] === 'undefined'){
                  vwiresLut[vwireName]={source:[],target:[]};
              }
              var twire=vw.target;
              twire.size=vw.size;
              vwiresLut[vwireName].target.push(twire);
            }
            if(vw.target.block === block.id){
              var vwireName = busname + lookupPortMonitorName(vw.target.port, bustype);
              if(typeof vwiresLut[vwireName] === 'undefined'){
                  vwiresLut[vwireName]={source:[],target:[]};
              }
              var twire=vw.source;
              twire.size=vw.size;
              vwiresLut[vwireName].source.push(twire);
            }
          }
        };

        // Let virtual wires connect to this block
        var procBusInput = function (block, busname, bustype) {
          var bus = common.bus[bustype];
          for (var pi in bus.ports) {
            var p = bus.ports[pi];
            var vwireName = busname + p.name_monitor;
            if (typeof vwiresLut[vwireName] === 'undefined') {
              vwiresLut[vwireName]={source:[],target:[]};
            }
            if (p.source === 'master') {
              vwiresLut[vwireName].source.push({
                block: block.id,
                port: p.name_master,
                size: p.size 
              });
            } else {
              vwiresLut[vwireName].target.push({
                block: block.id,
                port: p.name_master,
                size: p.size 
              });  
            }
          }
        };

        // Let virtual wires connect to this block
        var procBusOutput = function (block, busname, bustype) {
          var bus = common.bus[bustype];
          for (var pi in bus.ports) {
            var p = bus.ports[pi];
            var vwireName = busname + p.name_monitor;
            if (typeof vwiresLut[vwireName] === 'undefined') {
              vwiresLut[vwireName]={source:[],target:[]};
            }
            if (p.source === 'slave') {
              vwiresLut[vwireName].source.push({
                block: block.id,
                port: p.name_slave,
                size: p.size 
              });
            } else {
              vwiresLut[vwireName].target.push({
                block: block.id,
                port: p.name_slave,
                size: p.size 
              });  
            }
          }
        };

        // Let virtual wires connect to this block
        var procBusGenericInput = function (block, busname, bustype, portid) {
          var bus = common.bus[bustype];
          
          var moduleName = project.nameList.moduleNames[block.type];
          var portName = project.nameList.portNames[moduleName][portid];

          for (var pi in bus.ports) {
            var p = bus.ports[pi];
            var vwireName = busname + p.name_monitor;
            if (typeof vwiresLut[vwireName] === 'undefined') {
              vwiresLut[vwireName]={source:[],target:[]};
            }
            if (p.source === 'slave') {
              vwiresLut[vwireName].source.push({
                block: block.id,
                port: portName + p.name_slave,
                size: p.size,
                finalname: true
              });
            } else {
              vwiresLut[vwireName].target.push({
                block: block.id,
                port: portName + p.name_slave,
                size: p.size,
                finalname: true
              });  
            }
          }
        };

        // Let virtual wires connect to this block
        var procBusGenericOutput = function (block, busname, bustype, portid) {
          var bus = common.bus[bustype];
          
          var moduleName = project.nameList.moduleNames[block.type];
          var portName = project.nameList.portNames[moduleName][portid];

          for (var pi in bus.ports) {
            var p = bus.ports[pi];
            var vwireName = busname + p.name_monitor;
            if (typeof vwiresLut[vwireName] === 'undefined') {
              vwiresLut[vwireName]={source:[],target:[]};
            }
            if (p.source === 'master') {
              vwiresLut[vwireName].source.push({
                block: block.id,
                port: portName + p.name_master,
                size: p.size,
                finalname: true
              });
            } else {
              vwiresLut[vwireName].target.push({
                block: block.id,
                port: portName + p.name_master,
                size: p.size,
                finalname: true 
              });  
            }
          }
        };

        // Use virtual wire generation per bus rather than per block
        // businterface -> virtual wire
        // busport -> virtual wire to virtual port
        // generic -> translated port
        for(widx in graph.wires) {
          vw = graph.wires[widx];
          if (CheckTypeIsBus(vw.size)) {
            // Bus wire
            var busname = vw.source.block + vw.source.port;
            var bustype = vw.size;
            var sourceBlock = undefined;
            var targetBlock = undefined;

            for (var b in graph.blocks) {
              var block = graph.blocks[b];
              if (block.id === vw.source.block) {
                sourceBlock = block;
              }
              if (block.id === vw.target.block) {
                targetBlock = block;
              }
            }

            if (sourceBlock.type === 'basic.busInterface') {
              procBusInterface(sourceBlock, busname, bustype);
            } else if (sourceBlock.type === 'basic.busInput') {
              procBusInput(sourceBlock, busname, bustype);
            } else if (sourceBlock.type === 'basic.busOutput') {
              procBusOutput(sourceBlock, busname, bustype);
            } else {
              procBusGenericOutput(sourceBlock, busname, bustype, vw.source.port);
            }

            if (targetBlock.type === 'basic.busInterface') {
              procBusInterface(targetBlock, busname, bustype);
            } else if (targetBlock.type === 'basic.busInput') {
              procBusInput(targetBlock, busname, bustype);
            } else if (targetBlock.type === 'basic.busOutput') {
              procBusOutput(targetBlock, busname, bustype);
            } else {
              procBusGenericInput(targetBlock, busname, bustype, vw.target.port);
            }
          }
        }

        //Create virtual wires
        for(widx in vwiresLut){
            vw=vwiresLut[widx];
            if(vw.source.length>0 && vw.target.length>0){
                for(var vi=0;vi<vw.source.length;vi++){
                    for(var vj=0;vj<vw.target.length;vj++){
                        graph.wires.push({
                            tcTodelete: true,
                            size: vw.size,
                            source:vw.source[vi],
                            target:vw.target[vj],
                            vertices:undefined
                        });
                    }
                }
            }
        }

        // Remove virtual blocks
        // Save temporal wires and delete it

        graph.wiresVirtual=[];
        var wtemp=[];
        var iwtemp;
        var wi;
        var getBlockById = function(id) {
          for (var b in graph.blocks) {
            var block = graph.blocks[b];
            if (block.id === id) {
              return block;
            }
          }
        }

        for (wi=0;wi<graph.wires.length;wi++){

            if( graph.wires[wi].source.port === 'outlabel' ||
                graph.wires[wi].target.port  === 'outlabel' ||
                graph.wires[wi].source.port === 'inlabel' ||
                graph.wires[wi].target.port === 'inlabel' ||
                CheckTypeIsBus(graph.wires[wi].size)
                ){

                    graph.wiresVirtual.push(graph.wires[wi]);

            }else{
                iwtemp=graph.wires[wi];
                if(typeof iwtemp.source.size !== 'undefined'){
                    iwtemp.size=iwtemp.source.size;
                }
                wtemp.push(iwtemp);
            }
        }
        graph.wires=wtemp;
        // End of rearrange design connections for compilation


      for (w in graph.wires) {
        var wire = graph.wires[w];
        if (wire.source.port === 'constant-out' ||
            wire.source.port === 'memory-out') {
          // Local Parameters
          var constantBlock = findBlock(wire.source.block, graph);
          var paramValue = utils.digestId(constantBlock.id);
          if (paramValue) {
            connections.localparam.push('localparam p' + w + ' = ' + project.nameList.paramNames[name][constantBlock.id] + ';');
          }
        }
        else {
          // Wires
          var range = wire.size ? ' [' + (wire.size-1) +':0] ' : ' ';
          connections.wire.push('wire' + range + 'w' + w + ';');
        }
        // Assignations
        for (i in graph.blocks) {
          var block = graph.blocks[i];
          if (block.type === 'basic.input') {
            if (wire.source.block === block.id) {
              connections.assign.push('assign w' + w + ' = ' + getPortName(name, block, i, project.nameList) + ';');
              wireSource[w] = getPortName(name, block, i, project.nameList);
            }
          }
          else if (block.type === 'basic.output') {
            if (wire.target.block === block.id) {
              if (wire.source.port === 'constant-out' ||
                  wire.source.port === 'memory-out') {
                // connections.assign.push('assign ' + digestId(block.id) + ' = p' + w + ';');
              }
              else {
                connections.assign.push('assign ' + getPortName(name, block, i, project.nameList) + ' = w' + w + ';');
                wireSource[getPortName(name, block, i, project.nameList)] = 'w' + w;
              }
            }
          }
          else if (block.type === 'basic.busInput' || block.type === 'basic.busOutput') {
            if (wire.source.block === block.id) {
              var portname = getPortName(name, block, i, project.nameList) + wire.source.port;
              connections.assign.push('assign w' + w + ' = ' + portname + ';');
              wireSource[w] = portname;
            }
            if (wire.target.block === block.id) {
              var portname = getPortName(name, block, i, project.nameList) + wire.target.port;
              connections.assign.push('assign ' + portname + ' = w' + w + ';');
              wireSource[portname] = 'w' + w;
            }
          }
        }
      }

      content = content.concat(connections.localparam);
      content = content.concat(connections.wire);
      content = content.concat(connections.assign);

      // Wires Connections

      var numWires = graph.wires.length;
        var gwi,gwj;
      for (i = 1; i < numWires; i++) {
        for (j = 0; j < i; j++) {
          gwi = graph.wires[i];
          gwj = graph.wires[j];
          if (gwi.source.block === gwj.source.block &&
              gwi.source.port === gwj.source.port &&
              gwi.source.port !== 'constant-out' &&
              gwi.source.port !== 'memory-out' &&
              !wireSource[i]) {
            content.push('assign w' + i + ' = w' + j + ';');
            wireSource[i] = 'w' + j;
          }
        }
      }

      // Block instances

      content = content.concat(getInstances(name, project.design.graph, project.nameList));

        // Restore original graph
        // delete temporal wires
        //

        wtemp=[];
        for ( wi=0;wi<graph.wires.length;wi++){
            if(typeof graph.wires[wi].tcTodelete !== 'undefined'  &&
                graph.wires[wi].tcTodelete === true){
                //Nothing for now, only remove
            }else{
                wtemp.push(graph.wires[wi]);
            }

        }

        graph.wires= graph.wiresVirtual.concat(wtemp);
        delete graph.wiresVirtual;
        //END ONWORK




      return content.join('\n');
    }

    function getInstances(name, graph, nameList) {
      var w, wire;
      var instances = [];
      var blocks = graph.blocks;

      for (var b in blocks) {
        var block = blocks[b];

        if (block.type !== 'basic.input' &&
            block.type !== 'basic.output' &&
            block.type !== 'basic.constant' &&
            block.type !== 'basic.memory' &&
            block.type !== 'basic.info' &&
            block.type !== 'basic.inputLabel' &&
            block.type !== 'basic.outputLabel' &&
            block.type !== 'basic.busInterface' &&
            block.type !== 'basic.busInput' &&
            block.type !== 'basic.busOutput'
            ) {

          // Header

          var instance;
          instance = getModuleName(name, block, b, nameList);

          //-- Parameters

          var params = [];
          for (w in graph.wires) {
            wire = graph.wires[w];
            if ((block.id === wire.target.block) &&
                (wire.source.port === 'constant-out' ||
                 wire.source.port === 'memory-out')) {
              var paramName = wire.target.port;
              if (block.type !== 'basic.code') {
                var moduleName = nameList.moduleNames[block.type];
                paramName = nameList.paramNames[moduleName][paramName];
                //paramName = utils.digestId(paramName);
              }
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

          instance += ' ' +  getInstanceName(name, block, b, nameList);

          //-- Ports

          var ports = [];
          var portsNames = [];
          for (w in graph.wires) {
            wire = graph.wires[w];
            if (block.id === wire.source.block) {
              connectPort(wire.source, portsNames, ports, block, nameList);
            }
            if (block.id === wire.target.block) {
              if (wire.source.port !== 'constant-out' &&
                  wire.source.port !== 'memory-out') {
                connectPort(wire.target, portsNames, ports, block, nameList);
              }
            }
          }

          instance += ' (\n' + ports.join(',\n') + '\n);';

          if (instance) {
            instances.push(instance);
          }
        }
      }

      function connectPort(port, portsNames, ports, block, nameList) {
        if (port) {
          var portName = port.port;
          if (!port.finalname && block.type !== 'basic.code') {
            var moduleName = nameList.moduleNames[block.type];
            portName = nameList.portNames[moduleName][portName];
            // portName = utils.digestId(portName);
          }
          if (portsNames.indexOf(portName) === -1) {
            portsNames.push(portName);
            var port = '';
            port += ' .' + portName;
            port += '(w' + w + ')';
            ports.push(port);
          }
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

    this.getInitPorts = getInitPorts;
    function getInitPorts(project) {
      // Find not connected input wire ports to initialize

      var i, j;
      var initPorts = [];
      var blocks = project.design.graph.blocks;

      // Find all not connected input ports:
      // - Code blocks
      // - Generic blocks
      for (i in blocks) {
        var block = blocks[i];
        if (block) {
          if (block.type === 'basic.code' || !block.type.startsWith('basic.')) {
            // Code block or Generic block
            for (j in block.data.ports.in) {
              var inPort = block.data.ports.in[j];
              if (inPort.default && inPort.default.apply) {
                initPorts.push({
                  block: block.id,
                  port: inPort.name,
                  name: inPort.default.port,
                  pin: inPort.default.pin
                });
              }
            }
          }
        }
      }

      return initPorts;
    }

    this.getInitPins = getInitPins;
    function getInitPins(project) {
      // Find not used output pins to initialize

      var i;
      var initPins = [];
      var usedPins = [];
      var blocks = project.design.graph.blocks;

      // Find all set output pins
      for (i in blocks) {
        var block = blocks[i];
        if (block.type === 'basic.output') {
          for (var p in block.data.pins) {
            usedPins.push(block.data.virtual ? '' : block.data.pins[p].value);
          }
        }
      }

      // Filter pins defined in rules
      var allInitPins = common.selectedBoard.rules.output;
      for (i in allInitPins) {
        if (usedPins.indexOf(allInitPins[i].pin) === -1) {
          initPins.push(allInitPins[i]);
        }
      }

      return initPins;
    }

    function verilogCompiler(name, project, opt) {
      var i, data, block, code = '', codeModule = '';
      var nameList = {};
      opt = opt || {};

      if (project &&
          project.design &&
          project.design.graph) {

        var blocks = project.design.graph.blocks;
        var dependencies = project.dependencies;

        // Main module

        if (name) {

          // Setup module name dict ahead of compiling
          if (!project.nameList) {
            project.nameList = nameList;
            nameList.moduleNames = new Array();
            nameList.portNames = new Array();
            nameList.paramNames = new Array();
          } else {
            nameList = project.nameList;
          }

          // Build modules in prior to content to generate module names 
          // Code modules

          for (i in blocks) {
            block = blocks[i];
            if (block) {
              if (block.type === 'basic.code') {
                data = {
                  //name: name + '_' + utils.digestId(block.id),
                  name: getModuleName(name, block, i, nameList),
                  params: block.data.params,
                  ports: block.data.ports,
                  content: block.data.code //.replace(/\n+/g, '\n').replace(/\n$/g, '')
                };
                codeModule += module(data);
              }
            }
          }

          // Dependencies modules
          // Load all module names in prior to generating codes
          for (var d in dependencies) {
            dependencies[d].nameList = nameList;
            var mname = getDependencyModuleName(d, dependencies[d], nameList);
            getPorts(mname, dependencies[d]);
            getParams(mname, dependencies[d]);
          }
          for (var d in dependencies) {
            var mname = getDependencyModuleName(d, dependencies[d], nameList);
            codeModule += verilogCompiler(mname, dependencies[d]);
            delete dependencies[d].nameList;
          }
          

          // Initialize input ports

          if (name === 'main' && opt.boardRules) {

            var initPorts = opt.initPorts || getInitPorts(project);
            for (i in initPorts) {
              var initPort = initPorts[i];

              // Find existing input block with the initPort value
              var found = false;
              var source = {
                block: initPort.name,
                port: 'out'
              };
              for (i in blocks) {
                block = blocks[i];
                if (block.type === 'basic.input' &&
                    !block.data.range &&
                    !block.data.virtual &&
                    initPort.pin === block.data.pins[0].value) {
                  found = true;
                  source.block = block.id;
                  break;
                }
              }

              if (!found) {
                // Add imaginary input block with the initPort value
                project.design.graph.blocks.push({
                  id: initPort.name,
                  type: 'basic.input',
                  data: {
                    name: initPort.name,
                    pins: [
                      {
                        index: '0',
                        value: initPort.pin
                      }
                    ],
                    virtual: false
                  }
                });
              }

              // Add imaginary wire between the input block and the initPort
              project.design.graph.wires.push({
                source: {
                  block: source.block,
                  port: source.port
                },
                target: {
                  block: initPort.block,
                  port: initPort.port
                }
              });
            }
          }


          var params = getParams(name, project);
          var ports = getPorts(name, project);
          var content = getContent(name, project);

          // Initialize output pins

          if (name === 'main' && opt.boardRules) {

            var initPins = opt.initPins || getInitPins(project);
            var n = initPins.length;

            if (n > 0) {
              // Declare m port
              ports.out.push({
                name: 'vinit',
                range: '[' + (n-1) + ':0]'
              });
              // Generate port value
              var value = '';
              for (i in initPins) {
                value = initPins[i].bit + value;
              }
              value = n.toString() + '\'b' + value;
              
              // Assign m port
              content += '\nassign vinit = ' + value + ';';
            }
          }

          data = {
            name: name,
            params: params,
            ports: ports,
            content: content
          };
          code += module(data);

          // release namelist
          if (name === 'main') {
            delete project.nameList;
          }
        }

        code += codeModule;
      }

      return code;
    }

    function ioConstraintCompiler(project, opt) {
      var constraintType = common.selectedBoard.info.constraint || 'PCF';
      switch (constraintType) {
        case 'PCF':
          return pcfCompiler(project, opt);
        case 'ADC':
          return adcCompiler(project, opt);
      }
    }

    function pcfCompiler(project, opt) {
      var i, j, block, pin, value, code = '';
      var blocks = project.design.graph.blocks;
      opt = opt || {};

      for (i in blocks) {
        block = blocks[i];
        if (block.type === 'basic.input' ||
            block.type === 'basic.output') {

          if (block.data.pins.length > 1) {
            for (var p in block.data.pins) {
              pin = block.data.pins[p];
              value = block.data.virtual ? '' : pin.value;
              code += 'set_io ';
              code += utils.digestId(block.id);
              code += '[' + pin.index + '] ';
              code += value;
              code += '\n';
            }
          }
          else if (block.data.pins.length > 0) {
            pin = block.data.pins[0];
            value = block.data.virtual ? '' : pin.value;
            code += 'set_io ';
            code += utils.digestId(block.id);
            code += ' ';
            code += value;
            code += '\n';
          }
        }
      }

      if (opt.boardRules) {
        // Declare init input ports

        var used = [];
        var initPorts = opt.initPorts || getInitPorts(project);
        for (i in initPorts) {
          var initPort = initPorts[i];
          if (used.indexOf(initPort.pin) !== -1) {
            break;
          }
          used.push(initPort.pin);

          // Find existing input block with the initPort value
          var found = false;
          for (j in blocks) {
            block = blocks[j];
            if (block.type === 'basic.input' &&
            !block.data.range &&
            !block.data.virtual &&
            initPort.pin === block.data.pins[0].value) {
              found = true;
              used.push(initPort.pin);
              break;
            }
          }

          if (!found) {
            code += 'set_io v';
            code += initPorts[i].name;
            code += ' ';
            code += initPorts[i].pin;
            code += '\n';
          }
        }

        // Declare init output pins

        var initPins = opt.initPins || getInitPins(project);
        if (initPins.length > 1) {
          for (i in initPins) {
            code += 'set_io vinit[' + i + '] ';
            code += initPins[i].pin;
            code += '\n';
          }
        }
        else if (initPins.length > 0) {
          code += 'set_io vinit ';
          code += initPins[0].pin;
          code += '\n';
        }
      }

      return code;
    }
    function adcCompiler(project, opt) {
      var i, j, block, pin, value, code = '';
      var blocks = project.design.graph.blocks;
      opt = opt || {};

      var nameList = {};
      nameList.portNames = new Array();

      for (i in blocks) {
        block = blocks[i];
        if (block.type === 'basic.input' ||
            block.type === 'basic.output') {

          if (block.data.pins.length > 1) {
            for (var p in block.data.pins) {
              pin = block.data.pins[p];
              value = block.data.virtual ? '' : pin.value;
              code += 'set_pin_assignment {';
              code += getPortName('main', block, i, nameList);
              code += '[' + pin.index + ']';
              code += '} { LOCATION = '
              code += value;
              code += '; IOSTANDARD = LVCMOS33;  }'
              code += '\n';
            }
          }
          else if (block.data.pins.length > 0) {
            pin = block.data.pins[0];
            value = block.data.virtual ? '' : pin.value;
            code += 'set_pin_assignment {';
            code += getPortName('main', block, i, nameList);
            code += '} { LOCATION = '
            code += value;
            code += '; IOSTANDARD = LVCMOS33;  }'
            code += '\n';
          }
        }
      }

      if (opt.boardRules) {
        // Declare init input ports

        var used = [];
        var initPorts = opt.initPorts || getInitPorts(project);
        for (i in initPorts) {
          var initPort = initPorts[i];
          if (used.indexOf(initPort.pin) !== -1) {
            break;
          }
          used.push(initPort.pin);

          // Find existing input block with the initPort value
          var found = false;
          for (j in blocks) {
            block = blocks[j];
            if (block.type === 'basic.input' &&
            !block.data.range &&
            !block.data.virtual &&
            initPort.pin === block.data.pins[0].value) {
              found = true;
              used.push(initPort.pin);
              break;
            }
          }

          if (!found) {
            code += 'set_pin_assignment {';
            code += initPorts[i].name;
            code += '} { LOCATION = '
            code += initPorts[i].pin;
            code += '; IOSTANDARD = LVCMOS33;  }'
            code += '\n';
          }
        }

        // Declare init output pins

        var initPins = opt.initPins || getInitPins(project);
        for (i in initPins) {
          code += 'set_pin_assignment {vinit[' + i + ']} { LOCATION = ';
          code += initPins[i].pin;
          code += '; IOSTANDARD = LVCMOS33;  }'
          code += '\n';
        }
      }

      return code;
    }
    function listCompiler(project) {
      var i;
      var listFiles = [];

      if (project &&
          project.design &&
          project.design.graph) {

        var blocks = project.design.graph.blocks;
        var dependencies = project.dependencies;

        // Find in blocks

        for (i in blocks) {
          var block = blocks[i];
          if (block.type === 'basic.memory') {
            listFiles.push({
              name: utils.digestId(block.id) + '.list',
              content: block.data.list
            });
          }
        }

        // Find in dependencies

        for (i in dependencies) {
          var dependency = dependencies[i];
          listFiles = listFiles.concat(listCompiler(dependency));
        }
      }

      return listFiles;
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
        if (input[i].name.toLowerCase() === 'clk') {
          hasClk = true;
          break;
        }
      }
      if (hasClk) {
        content += '\n// Clock signal\n';
        content += 'always #0.5 clk = ~clk;\n';
      }

      content += '\ninitial begin\n';
      content += ' // File were to store the simulation results\n';
      content += ' $dumpfile(`DUMPSTR(`VCD_OUTPUT));\n';
      content += ' $dumpvars(0, main_tb);\n\n';
      content += ' // TODO: initialize the registers here\n';
      content += ' // e.g. value = 1;\n';
      content += ' // e.g. #2 value = 0;\n';
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
              id: utils.digestId(block.id),
              name: block.data.name.replace(/ /g, '_'),
              range: block.data.range
            });
          }
          else {
            input.push({
              id: utils.digestId(block.id),
              name: inputUnnamed.toString(),
            });
            inputUnnamed += 1;
          }
        }
        else if (block.type === 'basic.output') {
          if (block.data.name) {
            output.push({
              id: utils.digestId(block.id),
              name: block.data.name.replace(/ /g, '_'),
              range: block.data.range
            });
          }
          else {
            output.push({
              id: utils.digestId(block.id),
              name: outputUnnamed.toString()
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
                id: utils.digestId(block.id),
                name: 'constant_' + block.data.name.replace(/ /g, '_'),
                value: block.data.value
              });
            }
            else {
              params.push({
                id: utils.digestId(block.id),
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
