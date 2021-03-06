'use strict';

angular.module('icestudio')
  .service('project', function ($rootScope,
    graph,
    boards,
    compiler,
    profile,
    utils,
    common,
    gui,
    gettextCatalog,
    nodeFs,
    nodePath) {

    this.name = '';  // Used in File dialogs
    this.path = '';  // Used in Save / Save as
    this.filepath = ''; // Used to find external resources (.v, .vh, .list)
    this.changed = false;
    this.backup = false;
    var project = _default();
    var resultAlert = null;

    function _default() {
      return {
        version: common.VERSION,
        package: {
          name: '',
          version: '',
          description: '',
          author: '',
          image: ''
        },
        design: {
          board: '',
          graph: { blocks: [], wires: [] }
        },
        dependencies: {}
      };
    }

    this.get = function (key) {
      if (key in project) {
        return project[key];
      }
      else {
        return project;
      }
    };

    this.set = function (key, obj) {
      if (key in project) {
        project[key] = obj;
      }
    };

    this.open = function (filepath, emptyPath) {
      var self = this;
      this.path = emptyPath ? '' : filepath;
      this.filepath = filepath;
      utils.readFile(filepath)
        .then(function (data) {
          var name = utils.basename(filepath);
          self.load(name, data);
        })
        .catch(function () {
          alertify.error(gettextCatalog.getString('Invalid project format'), 30);
        });
    };

    this.load = function (name, data) {
      var self = this;
      if (!checkVersion(data.version)) {
        return;
      }
      project = _safeLoad(data, name);
      if (project.design.board !== common.selectedBoard.name) {
        var projectBoard = boards.boardLabel(project.design.board);
        alertify.set('confirm', 'labels', {
          'ok': gettextCatalog.getString('Load'),
          'cancel': gettextCatalog.getString('Convert')
        });
        alertify.confirm(
          gettextCatalog.getString('This project is designed for the {{name}} board.', { name: utils.bold(projectBoard) }) + '<br>' +
          gettextCatalog.getString('You can load it as it is or convert it for the {{name}} board.', { name: utils.bold(common.selectedBoard.info.label) }),
          function () {
            // Load
            _load();
          },
          function () {
            // Convert
            project.design.board = common.selectedBoard.name;

            _load(true, boardMigration(projectBoard, common.selectedBoard.name));
          });
      }
      else {
        _load();
      }

      function _load(reset, originalBoard) {
        common.allDependencies = project.dependencies;
        var opt = { reset: reset || false, disabled: false };
        if (typeof originalBoard !== 'undefined' && originalBoard !== false) {
          for (var i = 0; i < common.boards.length; i++) {
            if (String(common.boards[i].name) === String(originalBoard)) {
              opt.originalPinout = common.boards[i].pinout;

            }
            if (String(common.boards[i].name) === String(project.design.board)) {
              opt.designPinout = common.boards[i].pinout;
            }
          }
        }

        var ret = graph.loadDesign(project.design, opt, function () {
          graph.resetCommandStack();
          graph.fitContent();
          alertify.success(gettextCatalog.getString('Project {{name}} loaded', { name: utils.bold(name) }));
          common.hasChangesSinceBuild = true;
        });

        if (ret) {
          profile.set('board', boards.selectBoard(project.design.board).name);
          self.updateTitle(name);
        }
        else {
          alertify.error(gettextCatalog.getString('Wrong project format: {{name}}', { name: utils.bold(name) }), 30);
        }
        setTimeout(function () {
          alertify.set('confirm', 'labels', {
            'ok': gettextCatalog.getString('OK'),
            'cancel': gettextCatalog.getString('Cancel')
          });
        }, 100);
      }
    };

    function boardMigration(oldBoard, newBoard) {

      var pboard = false;

      switch (oldBoard.toLowerCase()) {
        case 'icezum alhambra': case 'icezum':
          switch (newBoard.toLowerCase()) {
            case 'alhambra-ii': pboard = 'icezum'; break;
          }
          break;
      }
      return pboard;
    }


    function checkVersion(version) {
      if (version > common.VERSION) {
        var errorAlert = alertify.error(gettextCatalog.getString('Unsupported project format {{version}}', { version: version }), 30);
        alertify.message(gettextCatalog.getString('Click here to <b>download a newer version</b> of Icestudio'), 30)
          .callback = function (isClicked) {
            if (isClicked) {
              errorAlert.dismiss(false);
              gui.Shell.openExternal('https://github.com/FPGAwars/icestudio/releases');
            }
          };
        return false;
      }
      return true;
    }

    function _safeLoad(data, name) {
      // Backwards compatibility
      var project = {};
      switch (data.version) {
        case common.VERSION:
        case '1.1':
          project = data;
          break;
        case '1.0':
          project = convert10To12(data);
          break;
        default:
          project = convertTo10(data, name);
          project = convert10To12(project);
          break;
      }
      project.version = common.VERSION;
      return project;
    }

    function convert10To12(data) {
      var project = _default();
      project.package = data.package;
      project.design.board = data.design.board;
      project.design.graph = data.design.graph;

      var depsInfo = findSubDependencies10(data.design.deps);
      replaceType10(project, depsInfo);
      for (var d in depsInfo) {
        var dep = depsInfo[d];
        replaceType10(dep.content, depsInfo);
        project.dependencies[dep.id] = dep.content;
      }

      return project;
    }

    function findSubDependencies10(deps) {
      var depsInfo = {};
      for (var key in deps) {
        var block = utils.clone(deps[key]);
        // Go recursive
        var subDepsInfo = findSubDependencies10(block.design.deps);
        for (var name in subDepsInfo) {
          if (!(name in depsInfo)) {
            depsInfo[name] = subDepsInfo[name];
          }
        }
        // Add current dependency
        block = pruneBlock(block);
        delete block.design.deps;
        block.package.name = block.package.name || key;
        block.package.description = block.package.description || key;
        if (!(key in depsInfo)) {
          depsInfo[key] = {
            id: utils.dependencyID(block),
            content: block
          };
        }
      }
      return depsInfo;
    }

    function replaceType10(project, depsInfo) {
      for (var i in project.design.graph.blocks) {
        var type = project.design.graph.blocks[i].type;
        if (type.indexOf('basic.') === -1) {
          project.design.graph.blocks[i].type = depsInfo[type].id;
        }
      }
    }

    function convertTo10(data, name) {
      var project = {
        version: '1.0',
        package: {
          name: name || '',
          version: '',
          description: name || '',
          author: '',
          image: ''
        },
        design: {
          board: '',
          graph: {},
          deps: {}
        },
      };
      for (var b in data.graph.blocks) {
        var block = data.graph.blocks[b];
        switch (block.type) {
          case 'basic.input':
          case 'basic.output':
          case 'basic.outputLabel':
          case 'basic.inputLabel':
            block.data = {
              name: block.data.label,
              pins: [{
                index: '0',
                name: block.data.pin ? block.data.pin.name : '',
                value: block.data.pin ? block.data.pin.value : '0'
              }],
              virtual: false
            };
            break;
          case 'basic.constant':
            block.data = {
              name: block.data.label,
              value: block.data.value,
              local: false
            };
            break;
          case 'basic.code':
            var params = [];
            for (var p in block.data.params) {
              params.push({
                name: block.data.params[p]
              });
            }
            var inPorts = [];
            for (var i in block.data.ports.in) {
              inPorts.push({
                name: block.data.ports.in[i]
              });
            }

            var outPorts = [];
            for (var o in block.data.ports.out) {
              outPorts.push({
                name: block.data.ports.out[o]
              });
            }
            block.data = {
              code: block.data.code,
              params: params,
              ports: {
                in: inPorts,
                out: outPorts
              }
            };
            break;
        }
      }
      project.design.board = data.board;
      project.design.graph = data.graph;
      // Safe load all dependencies recursively
      for (var key in data.deps) {
        project.design.deps[key] = convertTo10(data.deps[key], key);
      }

      return project;
    }

    this.save = function (filepath, callback) {
      var backupProject = false;
      var name = utils.basename(filepath);
      if (subModuleActive) {
        backupProject = utils.clone(project);

      } else {

        this.updateTitle(name);
      }

      sortGraph();
      this.update();

      // Copy included files if the previous filepath
      // is different from the new filepath
      if (this.filepath !== filepath) {
        var origPath = utils.dirname(this.filepath);
        var destPath = utils.dirname(filepath);
        // 1. Parse and find included files
        var code = compiler.generate('verilog', project)[0].content;
        var listFiles = compiler.generate('list', project);
        var internalFiles = listFiles.map(function (res) { return res.name; });
        var files = utils.findIncludedFiles(code);
        files = _.difference(files, internalFiles);
        // Are there included files?
        if (files.length > 0) {
          // 2. Check project's directory
          if (filepath) {
            // 3. Copy the included files
            copyIncludedFiles(files, origPath, destPath, function (success) {
              if (success) {
                // 4. Success: save project
                doSaveProject();
              }
            });
          }
        }
        else {
          // No included files to copy
          // 4. Save project
          doSaveProject();
        }
      }
      else {
        // Same filepath
        // 4. Save project
        doSaveProject();
      }
      if (subModuleActive) {
        project = utils.clone(backupProject);
        //        sortGraph();
        //        this.update();


      } else {
        this.path = filepath;
        this.filepath = filepath;
      }

      function doSaveProject() {
        utils.saveFile(filepath, pruneProject(project))
          .then(function () {
            if (callback) {
              callback();
            }
            alertify.success(gettextCatalog.getString('Project {{name}} saved', { name: utils.bold(name) }));
          })
          .catch(function (error) {
            alertify.error(error, 30);
          });
      }

    };

    function sortGraph() {
      var cells = graph.getCells();

      // Sort Constant/Memory cells by x-coordinate
      cells = _.sortBy(cells, function (cell) {
        if (cell.get('type') === 'ice.Constant' ||
          cell.get('type') === 'ice.Memory') {
          return cell.get('position').x;
        }
      });

      // Sort I/O cells by y-coordinate
      cells = _.sortBy(cells, function (cell) {
        if (cell.get('type') === 'ice.Input' ||
          cell.get('type') === 'ice.Output') {
          return cell.get('position').y;
        }
      });

      graph.setCells(cells);
    }

    this.solveProject = function (proj) {
      var self = this;
      var blocks = proj.design.graph.blocks;

      var blockExtIOList = {};
      var evalDepId = [];

      var blockIDMap = {};
      var paramList = [];
      var paramContext = null;
      var rangeEvalList = {};
      var rangeEvalMap = {};


      for (var b in blocks) {
        var block = blocks[b];
        if (block.type === 'basic.constant') {
          paramList.push({
            name: block.data.name,
            value: block.data.value
          });
        }
      }

      for (var d in proj.dependencies) {
        proj.dependencies[d].evaled = false;
      }

      
      return utils.evalParameter(paramList)
        .then(function (rescontext) {
          console.log(rescontext);
          paramContext = rescontext.context;

          // 1. Solve size of block ports and I/O ports
          //    block.data.ports.in/out[].range -> .size
          //    I/O.data.range -> .size

          var evalDepPromise = [];

          for (var b in blocks) {
            var block = blocks[b];
            if (block.type === 'basic.input' || block.type === 'basic.output') {
              blockExtIOList[block.id] = block.data;

              if (block.data.dynamic) {
                var rangestr = block.data.range;
                if (!rangeEvalList[rangestr]) {
                  rangeEvalList[rangestr] = -1;
                  rangeEvalMap[rangestr] = [];
                }
                rangeEvalMap[rangestr].push(block.data);
                if (!blockIDMap[block.id]) {
                  blockIDMap[block.id] = {};
                }
                if (block.type === 'basic.input') {
                  blockIDMap[block.id].out = block.data;
                } else {
                  blockIDMap[block.id].in = block.data;
                }
              }
            } else if (block.type === 'basic.code') {
              var blockport = block.data.ports;
              for (var p in blockport.in) {
                var portin = blockport.in[p];
                if (portin.dynamic) {
                  var rangestr = portin.range;
                  if (!rangeEvalList[rangestr]) {
                    rangeEvalList[rangestr] = -1;
                    rangeEvalMap[rangestr] = [];
                  }
                  rangeEvalMap[rangestr].push(portin);
                  
                  if (!blockIDMap[block.id]) {
                    blockIDMap[block.id] = {};
                  }
                  blockIDMap[block.id][portin.name] = portin;
                }
              }
              for (var p in blockport.out) {
                var portout = blockport.out[p];
                if (portout.dynamic) {
                  var rangestr = portout.range;
                  if (!rangeEvalList[rangestr]) {
                    rangeEvalList[rangestr] = -1;
                    rangeEvalMap[rangestr] = [];
                  }
                  rangeEvalMap[rangestr].push(portout);

                  if (!blockIDMap[block.id]) {
                    blockIDMap[block.id] = {};
                  }
                  blockIDMap[block.id][portout.name] = portout;
                }
              }
            } else if (!block.type.startsWith('basic.')) {
              // Generic block
              // Use Promise.all() chain to evaluate
              // Use someway to pass parameters inside
              if (!proj.dependencies[block.type].evaled) {
                proj.dependencies[block.type].evaled = true;
                evalDepPromise.push(self.solveProject(proj.dependencies[block.type]));
                evalDepId.push(block.type);
              }
            }
          }
          // 1.1 Solve dependency blocks
          return Promise.all(evalDepPromise);
        })
        .then(function (iolist) {
          // Add dependency io in idmap
          for (var d in iolist) {
            var dep = iolist[d];
            blockIDMap[evalDepId[d]] = dep;
          }
          // 1.2 Solve current level
          return utils.evalPortSize(rangeEvalList, paramContext);
        })
        .then(function (reslist) {
          console.log(reslist);

          // 1.res Assign result to ports in list
          for (var param in reslist) {
            var resval = reslist[param];
            if (resval > 0) {
              for (var tgt in rangeEvalMap[param]) {
                var tgtitem = rangeEvalMap[param][tgt];
                tgtitem.size = resval;
              }
            }
          }

          // 2. Check all wires, replace wire with new size if both ends are with correct size

          for (var w in proj.design.graph.wires) {
            var wire = proj.design.graph.wires[w];

            var wsource = wire.source;
            var ssource = -1;
            if (blockIDMap[wsource.block]) {
              var sourcePort = blockIDMap[wsource.block][wsource.port];
              if (sourcePort) {
                ssource = sourcePort.size;
              }
            }

            var wtarget = wire.target;
            var starget = -1;
            if (blockIDMap[wtarget.block]) {
              var targetPort = blockIDMap[wtarget.block][wtarget.port];
              if (targetPort) {
                starget = targetPort.size;
              }
            }

            // Check if wire is dynamic at both end
            if (blockIDMap[wsource.block] && blockIDMap[wtarget.block]) {
              if (ssource > 0 && ssource === starget) {
                wire.size = ssource;
              } else {
                // Someway to raise an error
                wire.size = 96;
              }
            }
            
          }

          for (var d in proj.dependencies) {
            delete proj.dependencies[d].evaled;
          }

          console.log(proj);
          return blockExtIOList;
        });
    };

    this.addBlockFile = function (filepath, notification) {
      var self = this;
      utils.readFile(filepath)
        .then(function (data) {
          if (!checkVersion(data.version)) {
            return;
          }
          var name = utils.basename(filepath);
          var block = _safeLoad(data, name);
          if (block) {
            var origPath = utils.dirname(filepath);
            var destPath = utils.dirname(self.path);
            // 1. Parse and find included files
            var code = compiler.generate('verilog', block)[0].content;
            var listFiles = compiler.generate('list', block);
            var internalFiles = listFiles.map(function (res) { return res.name; });
            var files = utils.findIncludedFiles(code);
            files = _.difference(files, internalFiles);
            // Are there included files?
            if (files.length > 0) {
              // 2. Check project's directory
              if (self.path) {
                // 3. Copy the included files
                copyIncludedFiles(files, origPath, destPath, function (success) {
                  if (success) {
                    // 4. Success: import block
                    doImportBlock();
                  }
                });
              }
              else {
                alertify.confirm(gettextCatalog.getString('This import operation requires a project path. You need to save the current project. Do you want to continue?'),
                  function () {
                    $rootScope.$emit('saveProjectAs', function () {
                      setTimeout(function () {
                        // 3. Copy the included files
                        copyIncludedFiles(files, origPath, destPath, function (success) {
                          if (success) {
                            // 4. Success: import block
                            doImportBlock();
                          }
                        });
                      }, 500);
                    });
                  });
              }
            }
            else {
              // No included files to copy
              // 4. Import block
              doImportBlock();
            }
          }

          function doImportBlock() {
            self.addBlock(block);
            if (notification) {
              alertify.success(gettextCatalog.getString('Block {{name}} imported', { name: utils.bold(block.package.name) }));
            }
          }
        })
        .catch(function () {
          alertify.error(gettextCatalog.getString('Invalid project format'), 30);
        });
    };

    this.addRTLFile = function (filepath) {
      var self = this;
      utils.readRTLFile(filepath)
        .then(function (data) {
          var formSpecs = [
            {
              type: 'text',
              title: gettextCatalog.getString('Enter the name for new block'),
              value: ''
            },
            {
              type:'combobox',
              label: gettextCatalog.getString('Choose a module'),
              value: '',
              options: []
            }
          ];
          for (var i in data) {
            formSpecs[1].options.push({
                                        'value': i,
                                        'label': data[i].name
                                      });
          }
          formSpecs[1].value = '0';
          utils.renderForm(formSpecs, function(evt, values) {
            var blockName = values[0];
            var moduleId = values[1];

            var moduleObj = data[moduleId];

            if (blockName === '') {
              blockName = moduleObj.name + ' file wrapper';
            }

            if (resultAlert) {
              resultAlert.dismiss(false);
            }
            // Validate values
            if (!blockName) {
              evt.cancel = true;
              resultAlert = alertify.warning(gettextCatalog.getString('Wrong block name {{name}}', { name: blockName }));
            }
            // Find module and create new dependency
            process.nextTick(function() {
              utils.portSelectionPrompt(moduleObj, function(evt, values) {
                var moduleProj = _default();
                var fname = nodePath.basename(filepath);
                moduleProj.package.name = blockName;
                moduleProj.package.description = 'imported from ' + fname;
                moduleProj.design.board = profile.board;

                // Remove unused ports completely
                var selPort = [];
                for (var p in moduleObj.port) {
                  if (values.port[p]) {
                    selPort.push(moduleObj.port[p]);
                  }
                }
                moduleObj.port = selPort;

                // write code for code block
                var codes = [];
                codes.push('//@include ' + fname);
                codes.push('');
                if (moduleObj.parameter.length > 0) {
                  codes.push(moduleObj.name + ' #(');
                  var code_params = [];
                  for (var p in moduleObj.parameter) {
                    var pname = moduleObj.parameter[p].name;
                    code_params.push(['  .', pname, '(', pname, ')'].join(''));
                  }
                  codes.push(code_params.join(',\n'));
                  codes.push([') u_', moduleObj.name, ' ('].join(''));
                } else {
                  codes.push([moduleObj.name, ' u_', moduleObj.name, ' ('].join(''));
                }
                var code_ports = [];
                for (var p in moduleObj.port) {
                  var pname = moduleObj.port[p].name;
                  code_ports.push(['  .', pname, '(', pname, ')'].join(''));
                }
                codes.push(code_ports.join(',\n'));
                codes.push(');');
                codes.push('');

                var parameterCount = moduleObj.parameter.length;
                var inputCount = 0;
                var outputCount = 0;
                var portCount = 0;

                for (var i in moduleObj.port) {
                  var pitem = moduleObj.port[i];
                  if (pitem.direction === 'input') {
                    inputCount++;
                  } else {
                    outputCount++;
                  }
                }

                portCount = Math.max(inputCount, outputCount);

                // From blocks.js
                var gsize = 8;
                // Parameters
                var HBlocksSize = parameterCount * 15 * gsize;
                // + Padding
                var HCodeSize = Math.max(HBlocksSize + 0, 360);

                var HGraphSize = HCodeSize;
                if (portCount > 0) {
                  // + Wiring + I/O
                  HGraphSize += (2+4) * 15 * gsize;
                }

                // Ports
                var VBlocksSize = portCount * 10 * gsize;
                // + Padding
                var VCodeSize = Math.max(VBlocksSize + 0, 240);

                var VGraphSize = VCodeSize;
                if (parameterCount > 0) {
                  // + Wiring + Parameter
                  VGraphSize += (1+6) * 10 * gsize;
                }

                // Build Code block
                var cblock = {
                  'id': joint.util.uuid(),
                  'type': 'basic.code',
                  'data': {
                    'code': codes.join('\n'),
                    'params': [],
                    'ports': {
                      'in': [],
                      'out': []
                    }
                  },
                  'position': {
                    'x': -HCodeSize/2 - 12,
                    'y': -VCodeSize/2 - 8
                  },
                  'size': {
                    'width': HCodeSize,
                    'height': VCodeSize
                  }
                };

                // Build Parameter blocks
                // Hsize 15 Vsize 10
                var hPosition = {
                  'x': -HBlocksSize/2,
                  'y': -VGraphSize/2
                };
                var hStep = 15 * gsize;
                for (var i in moduleObj.parameter) {
                  var paraObj = moduleObj.parameter[i];
                  var newParaPort = { 'name': paraObj.name };
                  var newParaBlock = {
                    'id': joint.util.uuid(),
                    'type': 'basic.constant',
                    'data': {
                      'name': paraObj.name,
                      'value': paraObj.value,
                      'local': !values.parameter[i]
                    },
                  };
                  var newParaWire = {
                    'source': {
                      'block': newParaBlock.id,
                      'port': 'constant-out'
                    },
                    'target': {
                      'block': cblock.id,
                      'port': paraObj.name
                    }
                  };
                  newParaBlock.position = utils.clone(hPosition);
                  hPosition.x += hStep;
                  cblock.data.params.push(newParaPort);
                  moduleProj.design.graph.blocks.push(newParaBlock);
                  moduleProj.design.graph.wires.push(newParaWire);
                }
                // Build Port blocks
                // Hsize 15 Vsize 10
                var vPositionI = {
                  'x': -HGraphSize/2,
                  'y': -VBlocksSize/2
                };
                var vPositionO = {
                  'x': HGraphSize/2 - hStep,
                  'y': -VBlocksSize/2
                };
                var vStepI = 10*gsize;
                if (inputCount > 1) {
                  vStepI += (VBlocksSize - 10*gsize*inputCount) / (inputCount-1);
                } else if(inputCount === 1) {
                  vPositionI.y = -10*gsize/2;
                }
                var vStepO = 10*gsize;
                if (outputCount > 1) {
                  vStepO += (VBlocksSize - 10*gsize*outputCount) / (outputCount-1);
                } else if(outputCount === 1) {
                  vPositionO.y = -10*gsize/2;
                }
                for (var i in moduleObj.port) {
                  var portObj = moduleObj.port[i];
                  var newPortPort = { 'name': portObj.name };
                  var newPortBlock = {
                    'id': joint.util.uuid(),
                    'type': 'basic.' + ((portObj.direction === 'input') ? 'input' : 
                                        (portObj.direction === 'output') ? 'output' :
                                        'inout'),
                    'data': {
                      'name': portObj.name,
                      'virtual': true
                    }
                  };
                  var newPortWire = null;
                  if (portObj.direction === 'input') {
                    newPortWire = {
                      'source': {
                        'block': newPortBlock.id,
                        'port': 'out'
                      },
                      'target': {
                        'block': cblock.id,
                        'port': portObj.name
                      }
                    };
                    
                    newPortBlock.position = utils.clone(vPositionI);
                    vPositionI.y += vStepI;
                  } else {
                    newPortWire = {
                      'source': {
                        'block': cblock.id,
                        'port': portObj.name
                      },
                      'target': {
                        'block': newPortBlock.id,
                        'port': 'in'
                      }
                    };
                    newPortBlock.position = utils.clone(vPositionO);
                    vPositionO.y += vStepO;
                  }

                  // Add size info
                  if (portObj.packed) {
                    // var wsize = utils.evalRange(portObj.packed, env)
                    // To eval
                    var wsize = 1;
                    if (portObj.packed.match(/[^0-9\[\]:]/)) {
                      newPortPort.dynamic = true;
                      newPortBlock.data.dynamic = true;
                    } else {
                      var portnum = portObj.packed.substr(1, portObj.packed.length-2).split(':');
                      wsize = Math.abs(portnum[0] - portnum[1]) + 1;
                    }
                    newPortPort.range = portObj.packed;
                    newPortPort.size = wsize;
                    newPortBlock.data.range = portObj.packed;
                    newPortBlock.data.size = wsize;
                    newPortWire.size = wsize;
                  }
                  if (portObj.direction === 'input') {
                    cblock.data.ports.in.push(newPortPort);
                  } else {
                    cblock.data.ports.out.push(newPortPort);
                  }
                  moduleProj.design.graph.blocks.push(newPortBlock);
                  moduleProj.design.graph.wires.push(newPortWire);
                }
                // Finishing dependency project
                moduleProj.design.graph.blocks.push(cblock);
                
                self.solveProject(moduleProj).then(function () {
                  // Add block to project
                  self.addBlock(moduleProj);
                  alertify.success(gettextCatalog.getString('Block {{name}} imported', { name: utils.bold(blockName) }));
                });
              });
            });
          });
          console.log(data);
        });
    };

    function copyIncludedFiles(files, origPath, destPath, callback) {
      var success = true;
      async.eachSeries(files, function (filename, next) {
        setTimeout(function () {
          if (origPath !== destPath) {
            if (nodeFs.existsSync(nodePath.join(destPath, filename))) {
              alertify.confirm(gettextCatalog.getString('File {{file}} already exists in the project path. Do you want to replace it?', { file: utils.bold(filename) }),
                function () {
                  success = success && doCopySync(origPath, destPath, filename);
                  if (!success) {
                    return next(); // break
                  }
                  next();
                },
                function () {
                  next();
                });
            }
            else {
              success = success && doCopySync(origPath, destPath, filename);
              if (!success) {
                return next(); // break
              }
              next();
            }
          }
          else {
            return next(); // break
          }
        }, 0);
      }, function (/*result*/) {
        return callback(success);
      });
    }

    function doCopySync(origPath, destPath, filename) {
      var orig = nodePath.join(origPath, filename);
      var dest = nodePath.join(destPath, filename);
      var success = utils.copySync(orig, dest);
      if (success) {
        alertify.message(gettextCatalog.getString('File {{file}} imported', { file: utils.bold(filename) }), 5);
      }
      else {
        alertify.error(gettextCatalog.getString('Original file {{file}} does not exist', { file: utils.bold(filename) }), 30);
      }
      return success;
    }

    function pruneProject(project) {
      var _project = utils.clone(project);

      _prune(_project);
      for (var d in _project.dependencies) {
        _prune(_project.dependencies[d]);
      }

      function _prune(_project) {
        delete _project.design.state;
        for (var i in _project.design.graph.blocks) {
          var block = _project.design.graph.blocks[i];
          switch (block.type) {
            case 'basic.input':
            case 'basic.output':
            case 'basic.inout':
            case 'basic.outputLabel':
            case 'basic.inputLabel':
            case 'basic.constant':
            case 'basic.memory':
            case 'basic.busInterface':
            case 'basic.busInput':
            case 'basic.busOutput':
              break;
            case 'basic.code':
              for (var j in block.data.ports.in) {
                delete block.data.ports.in[j].default;
              }
              break;
            case 'basic.info':
              delete block.data.text;
              break;
            default:
              // Generic block
              delete block.data;
              break;
          }
        }
      }

      return _project;
    }

    this.snapshot = function () {
      this.backup = utils.clone(project);
    };

    this.restoreSnapshot = function () {
      project = utils.clone(this.backup);

    };

    this.update = function (opt, callback) {
      var graphData = graph.toJSON();
      var p = utils.cellsToProject(graphData.cells, opt);
      project.design.board = p.design.board;
      project.design.graph = p.design.graph;
      project.dependencies = p.dependencies;
      if (subModuleActive && typeof common.submoduleId !== 'undefined' && typeof common.allDependencies[common.submoduleId] !== 'undefined') {
        project.package = common.allDependencies[common.submoduleId].package;
      }
      var state = graph.getState();
      project.design.state = {
        pan: {
          x: parseFloat(state.pan.x.toFixed(4)),
          y: parseFloat(state.pan.y.toFixed(4))
        },
        zoom: parseFloat(state.zoom.toFixed(4))
      };

      if (callback) {
        callback();
      }
    };

    this.updateTitle = function (name) {
      if (name) {
        this.name = name;
        graph.resetBreadcrumbs(name);
      }
      var title = (this.changed ? '*' : '') + this.name + ' ─ Icestudio';
      utils.updateWindowTitle(title);
    };

    this.compile = function (target) {
      this.update();
      var opt = { boardRules: profile.get('boardRules') };
      return compiler.generate(target, project, opt);
    };

    this.addBasicBlock = function (type) {
      graph.createBasicBlock(type);
    };

    this.addBlock = function (block) {
      if (block) {
        block = _safeLoad(block);
        block = pruneBlock(block);
        if (block.package.name.toLowerCase().indexOf('generic-') === 0) {
          var dat = new Date();
          var seq = dat.getTime();
          block.package.otid = seq;
        }
        var type = utils.dependencyID(block);
        utils.mergeDependencies(type, block);
        graph.createBlock(type, block);
      }
    };

    function pruneBlock(block) {
      // Remove all unnecessary information for a dependency:
      // - version, board, FPGA I/O pins (->size if >1), virtual flag
      delete block.version;
      delete block.design.board;
      var i, pins;
      for (i in block.design.graph.blocks) {
        if (block.design.graph.blocks[i].type === 'basic.input' ||
          block.design.graph.blocks[i].type === 'basic.output' ||
          block.design.graph.blocks[i].type === 'basic.inout' ||
          block.design.graph.blocks[i].type === 'basic.outputLabel' ||
          block.design.graph.blocks[i].type === 'basic.inputLabel'
        ) {
          if (block.design.graph.blocks[i].data.size === undefined) {
            pins = block.design.graph.blocks[i].data.pins;
            block.design.graph.blocks[i].data.size = (pins && pins.length > 1) ? pins.length : undefined;
          }
          delete block.design.graph.blocks[i].data.pins;
          // virtual always true for dependency, helps for copy out from dependency
          block.design.graph.blocks[i].data.virtual = true;
        }
      }
      return block;
    }

    this.removeSelected = function () {
      graph.removeSelected();
    };

    this.clear = function () {
      project = _default();
      graph.clearAll();
      graph.resetBreadcrumbs();
      graph.resetCommandStack();
    };

  });
