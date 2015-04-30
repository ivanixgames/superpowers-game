let serverRequire = require;
let THREE: any;
if (global.window == null) THREE = serverRequire("../../../../system/SupEngine").THREE;

import * as path from "path";
import * as fs from "fs";
import * as _ from "lodash";

import { Component } from "./SceneComponents";
import SceneNodes, { Node } from "./SceneNodes";

export interface DuplicatedNode {
  node: Node;
  parentId: string;
  index: number;
}

export default class SceneAsset extends SupCore.data.base.Asset {

  static schema = {
    nodes: { type: "array" },
  }

  pub: { nodes: Node[] };
  componentPathsByDependentAssetId: { [assetId: string]: string[] } = {};
  nodes: SceneNodes;

  constructor(id: string, pub: any, serverData: any) {
    super(id, pub, SceneAsset.schema, serverData);
  }

  init(options: any, callback: Function) {
    this.pub = { nodes: [] };
    super.init(options, callback);
  }

  setup() {
    this.nodes = new SceneNodes(this.pub.nodes);

    for (let nodeId in this.nodes.componentsByNodeId) {
      let components = this.nodes.componentsByNodeId[nodeId];
      for (let componentId in components.configsById) {
        let config = components.configsById[componentId];
        let componentPath = `${nodeId}_${componentId}`;
        ((config: SupCore.data.base.ComponentConfig, componentPath: string) => {
          config.on("addDependencies", (depIds: string[]) => { this._onAddComponentDependencies(componentPath, depIds); });
          config.on("removeDependencies", (depIds: string[]) => { this._onRemoveComponentDependencies(componentPath, depIds); });
        })(config, componentPath);
        config.restore();
      }
    }
  }

  /* NOTE: We're restore()'ing all the components during this.setup() since we need
   to rebuild this.componentPathsByDependentAssetId every time the scene asset
   is loaded.

   It's a bit weird but it all works out since this.setup() is called right before
   this.restore() anyway.*/
  restore() {
    this.emit("addDependencies", Object.keys(this.componentPathsByDependentAssetId));
  }

  server_addNode(client: any, name: string, options: any, callback: (err: string, node: Node, parentId: string, index: number) => any) {
    let sceneNode: Node = {
      id: null, name: name, children: <Node[]>[], components: <Component[]>[],
      position: (options != null && options.transform != null && options.transform.position != null) ? options.transform.position : { x: 0, y: 0, z: 0 },
      orientation: (options != null && options.transform != null && options.transform.orientation != null) ? options.transform.orientation : { x: 0, y: 0, z: 0, w: 1 },
      scale: (options != null && options.transform != null && options.transform.scale != null) ? options.transform.scale : { x: 1, y: 1, z: 1 },
    };

    let parentId = (options != null) ? options.parentId : null;
    let index = (options != null) ? options.index : null;
    this.nodes.add(sceneNode, parentId, index, (err, actualIndex) => {
      if (err != null) { callback(err, null, null, null); return; }

      callback(null, sceneNode, parentId, actualIndex);
      this.emit("change");
    });
  }

  client_addNode(node: Node, parentId: string, index: number) {
    this.nodes.client_add(node, parentId, index);
  }

  server_setNodeProperty(client: any, id: string, path: string, value: any, callback: (err: string, id: string, path: string, value: any) => any) {
    this.nodes.setProperty(id, path, value, (err, actualValue) => {
      if (err != null) { callback(err, null, null, null); return; }

      callback(null, id, path, actualValue);
      this.emit("change");
    });
  }

  client_setNodeProperty(id: string, path: string, value: any) {
    this.nodes.client_setProperty(id, path, value);
  }

  server_moveNode(client: any, id: string, parentId: string, index: number, callback: (err: string, id: string, parentId: string, index: number) => any) {
    let node = this.nodes.byId[id];
    if (node == null) { callback(`Invalid node id: ${id}`, null, null, null); return; }

    let globalMatrix = this.computeGlobalMatrix(node);

    this.nodes.move(id, parentId, index, (err, actualIndex) => {
      if (err != null) { callback(err, null, null, null); return; }

      this.applyGlobalMatrix(node, globalMatrix);

      callback(null, id, parentId, actualIndex);
      this.emit("change");
    });
  }

  computeGlobalMatrix(node: Node) {
    let matrix = new THREE.Matrix4().compose(<THREE.Vector3>node.position, <THREE.Quaternion>node.orientation, <THREE.Vector3>node.scale);

    let parentNode = this.nodes.parentNodesById[node.id]
    if (parentNode != null) {
      let parentGlobalMatrix = this.computeGlobalMatrix(parentNode);
      matrix.multiplyMatrices(parentGlobalMatrix, matrix);
    }
    return matrix;
  }

  applyGlobalMatrix(node: Node, matrix: THREE.Matrix4) {
    let parentNode = this.nodes.parentNodesById[node.id]
    if (parentNode == null) {
      let parentGlobalMatrix = this.computeGlobalMatrix(parentNode);
      matrix.multiplyMatrices(new THREE.Matrix4().getInverse(parentGlobalMatrix), matrix);
    }

    let position = new THREE.Vector3()
    let orientation = new THREE.Quaternion()
    let scale = new THREE.Vector3()
    matrix.decompose(position, orientation, scale);
    node.position = { x: position.x, y: position.y, z: position.z }
    node.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }
    node.scale = { x: scale.x, y: scale.y, z: scale.z }
  }

  client_moveNode(id: string, parentId: string, index: number) {
    this.nodes.client_move(id, parentId, index);
  }


  server_duplicateNode(client: any, newName: string, id: string, index: number, callback: (err: string, rootNode: Node, newNodes: DuplicatedNode[]) => any) {
    let referenceNode = this.nodes.byId[id]
    if (referenceNode == null) { callback(`Invalid node id: ${id}`, null, null); return; }

    let newNodes: DuplicatedNode[] = [];
    let totalNodeCount = 0
    let walk = (node: Node) => {
      totalNodeCount += 1
      for (let childNode of node.children) walk(childNode);
    }
    walk(referenceNode);

    let rootNode: Node = {
      id: null, name: newName, children: [],
      components: _.cloneDeep(referenceNode.components),
      position: _.cloneDeep(referenceNode.position),
      orientation: _.cloneDeep(referenceNode.orientation),
      scale: _.cloneDeep(referenceNode.scale),
    }
    let parentId = (this.nodes.parentNodesById[id] != null) ? this.nodes.parentNodesById[id].id : null;

    let addNode = (newNode: Node, parentId: string, index: number, children: Node[]) => {
      this.nodes.add(newNode, parentId, index, (err, actualIndex) => {
        if (err != null) { callback(err, null, null); return; }

        for (let componentId in this.nodes.componentsByNodeId[newNode.id].configsById) {
          let config = this.nodes.componentsByNodeId[newNode.id].configsById[componentId];
          let componentPath = `${newNode.id}_${componentId}`;
          ((config: SupCore.data.base.ComponentConfig, componentPath: string) => {
            config.on("addDependencies", (depIds: string[]) => { this._onAddComponentDependencies(componentPath, depIds); });
            config.on("removeDependencies", (depIds: string[]) => { this._onRemoveComponentDependencies(componentPath, depIds); });
          })(config, componentPath);
          config.restore()
        }
        newNodes.push({
          node: newNode,
          parentId: parentId,
          index: actualIndex,
        })

        if (newNodes.length === totalNodeCount) {
          callback(null, rootNode, newNodes);
          this.emit("change");
        }

        for (let childIndex = 0; childIndex < children.length; childIndex++) {
          let childNode = children[childIndex];
          let node: Node = {
            id: null, name: childNode.name, children: [],
            components: _.cloneDeep(childNode.components),
            position: _.cloneDeep(childNode.position),
            orientation: _.cloneDeep(childNode.orientation),
            scale: _.cloneDeep(childNode.scale),
          };
          addNode(node, newNode.id, childIndex, childNode.children);
        }
      });
    }
    addNode(rootNode, parentId, index, referenceNode.children);
  }

  client_duplicateNode(rootNode: Node, newNodes: DuplicatedNode[]) {
    for (let newNode of newNodes) {
      newNode.node.children.length = 0;
      this.nodes.client_add(newNode.node, newNode.parentId, newNode.index);
    }
  }

  server_removeNode(client: any, id: string, callback: (err: string, id: string) => any) {
    this.nodes.remove(id, (err) => {
      if (err != null) { callback(err, null); return; }

      callback(null, id);
      this.emit("change");
    });
  }

  client_removeNode(id: string) {
    this.nodes.client_remove(id);
  }

  // Components
  _onAddComponentDependencies(componentPath: string, depIds: string[]) {
    //console.log `Adding component dependencies: ${componentPath} - ${depIds}`
    let addedDepIds: string[] = [];

    for (let depId of depIds) {
      if (this.componentPathsByDependentAssetId[depId] == null) this.componentPathsByDependentAssetId[depId] = [];
      let componentPaths = this.componentPathsByDependentAssetId[depId];
      if (componentPaths.indexOf(componentPath) === -1) {
        componentPaths.push(componentPath);
        if (componentPaths.length === 1) addedDepIds.push(depId);
      }
    }

    if (addedDepIds.length > 0) this.emit("addDependencies", addedDepIds);
    }

  _onRemoveComponentDependencies(componentPath: string, depIds: string[]) {
    //console.log `Removing component dependencies: ${componentPath} - ${depIds}`
    let removedDepIds: string[] = [];

    for (let depId of depIds) {
      let componentPaths = this.componentPathsByDependentAssetId[depId];
      let index = (componentPaths != null) ? componentPaths.indexOf(componentPath): null;
      if (index != null && index !== -1) {
        componentPaths.splice(index, 1);

        if (componentPaths.length === 0) {
          removedDepIds.push(depId);
          delete this.componentPathsByDependentAssetId[depId];
        }
      }
    }

    if (removedDepIds.length > 0) this.emit("removeDependencies", removedDepIds);
  }

  server_addComponent(client: any, nodeId: string, componentType: string, index: number,
  callback: (err: string, nodeId: string, component: Component, index: number) => any) {

    let componentConfigClass = SupCore.data.componentConfigClasses[componentType];
    if (componentConfigClass == null) { callback("Invalid component type", null, null, null); return; }

    let component: Component = {
      type: componentType,
      config: componentConfigClass.create(),
    }

    this.nodes.addComponent(nodeId, component, index, (err, actualIndex) => {
      if (err != null) { callback(err, null, null, null); return; }

      let config = this.nodes.componentsByNodeId[nodeId].configsById[component.id];

      let componentPath = `${nodeId}_${component.id}`;
      config.on("addDependencies", (depIds: string[]) => { this._onAddComponentDependencies(componentPath, depIds); });
      config.on("removeDependencies", (depIds: string[]) => { this._onRemoveComponentDependencies(componentPath, depIds); });

      callback(null, nodeId, component, actualIndex);
      this.emit("change");
    });
  }

  client_addComponent(nodeId: string, component: Component, index: number) {
    this.nodes.client_addComponent(nodeId, component, index);
  }

  server_editComponent(client: any, nodeId: string, componentId: string, command: string, ...args: any[]) {
    let callback: (err: string, nodeId: string, componentId: string, command: string, ...args: any[]) => any = args.pop();

    let components = this.nodes.componentsByNodeId[nodeId];
    if (components == null) { callback(`Invalid node id: ${nodeId}`, null, null, null, null); return; }

    let componentConfig = components.configsById[componentId];
    if (componentConfig == null) { callback(`Invalid component id: ${componentId}`, null, null, null, null); return; }

    let commandMethod = (<any>componentConfig)[`server_${command}`];
    if (commandMethod == null) { callback("Invalid component command", null, null, null, null); return; }

    commandMethod.call(componentConfig, client, ...args, (err: string, ...callbackArgs: any[]) => {
      if (err != null) { callback(err, null, null, null, null); return; }

      callback(null, nodeId, componentId, command, ...callbackArgs);
      this.emit("change");
    });
  }

  client_editComponent(nodeId: string, componentId: string, command: string, ...args: any[]) {
    let componentConfig = this.nodes.componentsByNodeId[nodeId].configsById[componentId];

    let commandMethod = (<any>componentConfig)[`client_${command}`];
    commandMethod.call(componentConfig, ...args);
  }

  server_removeComponent(client: any, nodeId: string, componentId: string, callback: (err: string, nodeId: string, componentId: string) => any) {
    let components = this.nodes.componentsByNodeId[nodeId];
    if (components == null) { callback(`Invalid node id: ${nodeId}`, null, null); return; }

    components.remove(componentId, (err) => {
      if (err != null) { callback(err, null, null); return; }

      callback(null, nodeId, componentId);
      this.emit("change");
    });
  }

  client_removeComponent(nodeId: string, componentId: string) {
    this.nodes.componentsByNodeId[nodeId].client_remove(componentId);
  }
}
