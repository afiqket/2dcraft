import './style.css'
import Phaser from "phaser"

const CANVAS_WIDTH = 500
const CANVAS_HEIGHT = 500
const TILE_SIZE = 100
const PLAYER_SIZE = TILE_SIZE / 3
const PLAYER_SPEED = 200
const DEPTHS = {
  TILES: 0,
  BLOCKS: 10,
  HOVER: 20,
  PLAYER: 30
}
const TILE_DATA = {
  TILE_TYPE: "TILE_TYPE",
  BLOCK: "BLOCK"
}
const TREE_DATA = {
  HEALTH: "HEALTH"
}

const map = [
  [1, 1, 1, 0, 0, 0, 0],
  [1, 2, 2, 1, 1, 1, 0],
  [1, 2, 2, 1, 1, 1, 1],
  [0, 1, 1, 3, 1, 1, 0],
  [0, 0, 1, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 0],
]

const MAP_WIDTH = map[0].length * TILE_SIZE
const MAP_HEIGHT = map.length * TILE_SIZE

let TREE_POSITION
let PLAYER_POSITION

function gridToWorld(x, y) {
  return {
    x: x * TILE_SIZE,
    y: y * TILE_SIZE
  }
}

class GameScene extends Phaser.Scene {
  constructor() {
    super("scene-game");
    this.player;
    this.inputs;
    this.tileGroup;
    this.hoverBox;
    this.isInvalidPlacement = false;
    this.tree;
    this.emitter;
    this.inventoryText;
    this.inventoryWoodCount = 0;
    this.treeGroup
  }

  preload() {
    this.load.image("tree", "./assets/tree.png")
    this.load.image("tree_particle", "./assets/tree_particle.png")
  }

  addTree(x, y) {
    // Tree
    const treeWorld = gridToWorld(x, y)
    const tree = this.add.image(treeWorld.x, treeWorld.y, "tree")
      .setDepth(DEPTHS.BLOCKS)
      .setDisplaySize(TILE_SIZE, TILE_SIZE)
    this.textures.get("tree").setFilter(Phaser.Textures.FilterMode.NEAREST);
    tree.setData(TREE_DATA.HEALTH, 3)
    tree.setInteractive()
    tree.on("pointerdown", (pointer) => {
      const treeHealth = tree.getData(TREE_DATA.HEALTH) - 1
      tree.setData(TREE_DATA.HEALTH, treeHealth)
      this.emitter.startFollow(tree)
      this.emitter.start()
      
      // Shake tree
      this.tweens.add({
        targets: tree,
        x: treeWorld.x + 4,
        duration: 40,
        yoyo: true,
        repeat: 2,
        onComplete: () => {
          tree.x = treeWorld.x;
        }
      })

      if (treeHealth <= 0) {
        tree.destroy()
        this.inventoryWoodCount += 5
        this.inventoryText.setText(`WOOD: ${this.inventoryWoodCount}`)
      }
    }
    )
    this.treeGroup.add(tree)
  }

  create() {
    // Disable normal right click
    this.input.mouse.disableContextMenu();

    // Map bounds
    this.physics.world.setBounds(
      -TILE_SIZE / 2,
      -TILE_SIZE / 2,
      MAP_WIDTH,
      MAP_HEIGHT
    )

    // Red outline box when a tile is hovered 
    this.hoverBox = this.add.rectangle(
      0,
      0,
      TILE_SIZE,
      TILE_SIZE,
      0x000000,
      0
    )
      .setStrokeStyle(2, 0xff0000, 1)
      .setDepth(DEPTHS.HOVER)
      .setVisible(false)

    this.physics.add.existing(this.hoverBox, true)

    // Tree grouo
    this.treeGroup = this.physics.add.staticGroup();

    // Blocks on the ground
    this.tileGroup = this.physics.add.staticGroup();
    for (let row = 0; row < map.length; row++) {
      for (let col = 0; col < map[row].length; col++) {
        const tileId = map[row][col]
        let tileType
        let color
        switch (tileId) {
          case 0:
            // Water
            tileType = "water"
            color = 0x4f92d4
            break;

          case 1:
            // Gras
            tileType = "grass"
            color = 0x77DD77
            break;

          case 2:
            // Tree
            tileType = "grass"
            color = 0x77DD77
            this.addTree(col, row)
            break;

          case 3:
            // Player
            tileType = "grass"
            color = 0x77DD77
            PLAYER_POSITION = { x: col, y: row }
            break;

          default:
            break;
        }

        const { x, y } = gridToWorld(col, row)

        const tile = this.add.rectangle(
          x,
          y,
          TILE_SIZE,
          TILE_SIZE,
          color,
          1
        )

        tile.setStrokeStyle(1, 0x444444, 1)

        this.physics.add.existing(tile, true)

        tile.setData(TILE_DATA.TILE_TYPE, tileType)
        tile.setData(TILE_DATA.BLOCK, null)
        tile.setData(TILE_DATA.HOVER_BOX, null)

        // Required for mouse click events
        tile.setInteractive()

        tile.on("pointerdown", (pointer) => {
          if (pointer.rightButtonDown()) {
            if (tile.getData(TILE_DATA.BLOCK) || this.isInvalidPlacement || this.inventoryWoodCount === 0) {
              return
            }

            const block = this.add.rectangle(
              tile.x,
              tile.y,
              TILE_SIZE,
              TILE_SIZE,
              0x895129,
              1
            ).setDepth(DEPTHS.BLOCKS)

            tile.setData(TILE_DATA.BLOCK, block)

            this.physics.add.existing(block, true)
            this.tileGroup.add(block)

            this.inventoryWoodCount -= 1
            this.inventoryText.setText(`WOOD: ${this.inventoryWoodCount}`)
          }
          else if (pointer.leftButtonDown()) {
            const block = tile.getData(TILE_DATA.BLOCK)

            if (block) {
              this.inventoryWoodCount += 1
              this.inventoryText.setText(`WOOD: ${this.inventoryWoodCount}`)
              block.destroy()
              tile.setData(TILE_DATA.BLOCK, null)
            }
          }
        }
        )

        tile.on("pointerover", () => {
          this.hoverBox.setPosition(tile.x, tile.y)
          this.hoverBox.setVisible(true)
          this.hoverBox.body.updateFromGameObject()
        })

        tile.on("pointerout", () => {
          this.hoverBox.setVisible(false)
        })

        tile.setDepth(DEPTHS.TILES)
      }
    }

    // Player
    const playerWorld = gridToWorld(PLAYER_POSITION.x, PLAYER_POSITION.y)
    this.player = this.add.circle(playerWorld.x, playerWorld.y, PLAYER_SIZE, 0xDC143C, 1)
    this.player.setStrokeStyle(2, 0x000000, 1)
    this.player.setDepth(DEPTHS.PLAYER)
    this.physics.add.existing(this.player)



    // Effects
    this.emitter = this.add.particles(0, 0, "tree_particle", {
      speed: 300,
      lifespan: 150,
      gravityY: 1000,
      scale: 1,
      duration: 100,
      emitting: false
    }).setDepth(DEPTHS.PLAYER)

    // Text (Inventory)
    this.inventoryText = this.add.text(20, CANVAS_HEIGHT - 40, "WOOD: 0", {
      font: "25px Monospace",
      fill: "#000000"
    }).setScrollFactor(0) // Set dont move with camera

    // Controls
    /** @type {Phaser.Types.Input.Keyboard.CursorKeys} */
    this.inputs = this.input.keyboard.createCursorKeys()

    // Collision
    this.player.body.setCollideWorldBounds(true)
    this.physics.add.collider(this.player, this.tileGroup)
    this.physics.add.collider(this.player, this.tree)

    // Camera
    this.cameras.main.setBounds(
      -TILE_SIZE / 2,
      -TILE_SIZE / 2,
      MAP_WIDTH,
      MAP_HEIGHT
    )
    this.cameras.main.startFollow(this.player, true)
    this.cameras.main.setZoom(1)

  }

  update() {
    const { up, down, left, right } = this.inputs

    let velocityX = 0;
    let velocityY = 0;

    if (left.isDown) {
      velocityX = -1
    } else if (right.isDown) {
      velocityX = 1
    }

    if (up.isDown) {
      velocityY = -1
    } else if (down.isDown) {
      velocityY = 1
    }

    const vec = new Phaser.Math.Vector2(velocityX, velocityY)
      .normalize()
      .scale(PLAYER_SPEED)

    this.player.body.setVelocity(vec.x, vec.y);

    if (this.physics.overlap(this.player, this.hoverBox) || this.physics.overlap(this.treeGroup, this.hoverBox)) {
      this.isInvalidPlacement = true
    } else {
      this.isInvalidPlacement = false
    }

    // if (this.tree.getData(TREE_DATA.HEALTH) <= 0) {
    //   this.tree.destroy()
    //   this.inventoryWoodCount += 5
    //   this.inventoryText.setText(`WOOD: ${this.inventoryWoodCount}`)
    // }
  }
}

const config = {
  type: Phaser.WEBGL,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  canvas: gameCanvas,
  physics: {
    default: "arcade",
    arcade: {
      // gravity: { y: speedDown },
      // debug: true,
    },
  },
  // pixelArt: true,
  scene: [GameScene],
};

const game = new Phaser.Game(config);