import './style.css'
import Phaser from "phaser"

const CANVAS_WIDTH = 500
const CANVAS_HEIGHT = 500
const TILE_SIZE = 100
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
  [1, 1, 1, 0, 0],
  [1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1],
  [0, 1, 1, 1, 0],
  [0, 0, 1, 0, 0]
]

const TREE_POSITION = { x: 1, y: 1 }

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
  }

  preload() {
    this.load.image("tree", "./assets/tree.png")
    this.load.image("tree_particle", "./assets/tree_particle.png")
  }

  create() {
    // Disable normal right click
    this.input.mouse.disableContextMenu();

    // Red outline box when a tile is hovered 
    this.hoverBox = this.add.rectangle(
      0,
      0,
      TILE_SIZE,
      TILE_SIZE,
      0x000000,
      0
    ).setOrigin(0, 0)
      .setStrokeStyle(2, 0xff0000, 1)
      .setDepth(DEPTHS.HOVER)
      .setVisible(false)

    this.physics.add.existing(this.hoverBox, true)

    // Blocks on the ground
    this.tileGroup = this.physics.add.staticGroup();
    for (let i = 0; i < map.length; i++) {
      for (let j = 0; j < map[i].length; j++) {
        const tileType = map[j][i] ? "grass" : "water"
        const color = map[j][i] ? 0x77DD77 : 0x4f92d4

        const tile = this.add.rectangle(
          i * TILE_SIZE,
          j * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE,
          color,
          1
        ).setOrigin(0, 0)

        tile.setStrokeStyle(1, 0x444444, 1)

        this.physics.add.existing(tile, true)

        tile.setData(TILE_DATA.TILE_TYPE, tileType)
        tile.setData(TILE_DATA.BLOCK, null)
        tile.setData(TILE_DATA.HOVER_BOX, null)

        // Required for mouse click events
        tile.setInteractive()

        tile.on("pointerdown", (pointer) => {
          if (pointer.rightButtonDown()) {
            if (tile.getData(TILE_DATA.BLOCK) || this.isInvalidPlacement) {
              return
            }

            const block = this.add.rectangle(
              tile.x,
              tile.y,
              TILE_SIZE,
              TILE_SIZE,
              0x895129,
              1
            ).setOrigin(0, 0)
              .setDepth(DEPTHS.BLOCKS)

            tile.setData(TILE_DATA.BLOCK, block)

            this.physics.add.existing(block, true)
            this.tileGroup.add(block)
          }
          else if (pointer.leftButtonDown()) {
            const block = tile.getData(TILE_DATA.BLOCK)

            if (block) {
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
    this.player = this.add.circle(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, TILE_SIZE / 3, 0xDC143C, 1)
    this.player.setStrokeStyle(2, 0x000000, 1)
    this.player.setDepth(DEPTHS.PLAYER)
    this.physics.add.existing(this.player)

    // Tree
    this.tree = this.add.image(TREE_POSITION.x * TILE_SIZE, TREE_POSITION.y * TILE_SIZE, "tree")
      .setOrigin(0, 0)
      .setDepth(DEPTHS.BLOCKS)
      .setDisplaySize(TILE_SIZE, TILE_SIZE)
    this.textures.get("tree").setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.physics.add.existing(this.tree, true)
    this.tree.setData(TREE_DATA.HEALTH, 3)
    this.tree.setInteractive()
    this.tree.on("pointerdown", (pointer) => {
      const treeHealth = this.tree.setData(TREE_DATA.HEALTH, this.tree.getData(TREE_DATA.HEALTH) - 1)
      this.emitter.start()

      const tree_x = this.tree.x
      this.tweens.add({
        targets: this.tree,
        x: tree_x + 4,
        duration: 40,
        yoyo: true,
        repeat: 2,
        onComplete: () => {
          this.tree.x = tree_x;
        }
      })
    }
    )

    // Effects
    this.emitter = this.add.particles(this.tree.x + TILE_SIZE / 2, this.tree.y + TILE_SIZE / 2, "tree_particle", {
      speed: 300,
      lifespan: 150,
      gravityY: 1000,
      scale: 1,
      duration: 100,
      emitting: false
    }).setDepth(DEPTHS.PLAYER)

    // Controls
    /** @type {Phaser.Types.Input.Keyboard.CursorKeys} */
    this.inputs = this.input.keyboard.createCursorKeys()

    // Collision
    this.player.body.setCollideWorldBounds(true)
    this.physics.add.collider(this.player, this.tileGroup)
    this.physics.add.collider(this.player, this.tree)

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

    if (this.physics.overlap(this.player, this.hoverBox) || this.physics.overlap(this.tree, this.hoverBox)) {
      this.isInvalidPlacement = true
    } else {
      this.isInvalidPlacement = false
    }

    if (this.tree.getData(TREE_DATA.HEALTH) <= 0) {
      this.tree.destroy()
    }
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