import './style.css'
import Phaser from "phaser"

const CANVAS_WIDTH = 500
const CANVAS_HEIGHT = 500
const RECTANGLE_SIZE = 100
const PLAYER_SPEED = 200
const DEPTHS = {
  BLOCKS: 0,
  BLOCKONTOP: 10,
  HOVER: 20,
  PLAYER: 30
}
const RECT_DATA = {
  BLOCK_TYPE: "blockType",
  BLOCK_ON_TOP: "blockOnTop"
}

const map = [
  [0, 0, 1, 0, 0],
  [0, 1, 1, 1, 0],
  [1, 1, 1, 1, 1],
  [0, 1, 1, 1, 0],
  [0, 0, 1, 0, 0]
]

class GameScene extends Phaser.Scene {
  constructor() {
    super("scene-game");
    this.player;
    this.inputs;
    this.blockGroup;
    this.hoverBox;
    this.isHoverOnPlayer = false;
  }

  preload() {
  }

  create() {
    // Disable normal right click
    this.input.mouse.disableContextMenu();

    // Blocks on the ground
    this.blockGroup = this.physics.add.staticGroup();

    this.hoverBox = this.add.rectangle(
      0,
      0,
      RECTANGLE_SIZE,
      RECTANGLE_SIZE,
      0x000000,
      0
    ).setOrigin(0, 0)
      .setStrokeStyle(2, 0xff0000, 1)
      .setDepth(DEPTHS.HOVER)
      .setVisible(false)

    this.physics.add.existing(this.hoverBox, true)

    for (let i = 0; i < map.length; i++) {
      for (let j = 0; j < map[i].length; j++) {
        const blockType = map[i][j] ? "grass" : "water"
        const color = map[i][j] ? 0x77DD77 : 0x4f92d4

        const rect = this.add.rectangle(
          i * RECTANGLE_SIZE,
          j * RECTANGLE_SIZE,
          RECTANGLE_SIZE,
          RECTANGLE_SIZE,
          color,
          1
        ).setOrigin(0, 0)

        rect.setStrokeStyle(1, 0x444444, 1)

        this.physics.add.existing(rect, true)

        rect.setData(RECT_DATA.BLOCK_TYPE, blockType)
        rect.setData(RECT_DATA.BLOCK_ON_TOP, null)
        rect.setData(RECT_DATA.HOVER_BOX, null)

        // Required for mouse click events
        rect.setInteractive()

        rect.on("pointerdown", (pointer) => {
          if (pointer.leftButtonDown()) {
            if (rect.getData(RECT_DATA.BLOCK_ON_TOP) || this.isHoverOnPlayer) {
              return
            }

            const blockOnTop = this.add.rectangle(
              rect.x,
              rect.y,
              RECTANGLE_SIZE,
              RECTANGLE_SIZE,
              0x895129,
              1
            ).setOrigin(0, 0)
              .setDepth(DEPTHS.BLOCKONTOP)

            rect.setData(RECT_DATA.BLOCK_ON_TOP, blockOnTop)

            this.physics.add.existing(blockOnTop, true)
            this.blockGroup.add(blockOnTop)
          }
          else if (pointer.rightButtonDown()) {
            const blockOnTop = rect.getData(RECT_DATA.BLOCK_ON_TOP)

            if (blockOnTop) {
              blockOnTop.destroy()
              rect.setData(RECT_DATA.BLOCK_ON_TOP, null)
            }
          }
        }
        )

        rect.on("pointerover", () => {
          this.hoverBox.setPosition(rect.x, rect.y)
          this.hoverBox.setVisible(true)
          this.hoverBox.body.updateFromGameObject()
        })

        rect.on("pointerout", () => {
          this.hoverBox.setVisible(false)
        })

        rect.setDepth(DEPTHS.BLOCKS)
      }
    }

    // Player
    this.player = this.add.circle(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, RECTANGLE_SIZE / 3, 0xDC143C, 1)
    this.player.setStrokeStyle(2, 0x000000, 1)
    this.player.setDepth(DEPTHS.PLAYER)
    this.physics.add.existing(this.player)

    // Controls
    /** @type {Phaser.Types.Input.Keyboard.CursorKeys} */
    this.inputs = this.input.keyboard.createCursorKeys()

    // Collision
    this.player.body.setCollideWorldBounds(true)
    this.physics.add.collider(this.player, this.blockGroup)

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

    if (this.physics.overlap(this.player, this.hoverBox)) {
      this.isHoverOnPlayer = true
    } else {
      this.isHoverOnPlayer = false
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
  scene: [GameScene],
};

const game = new Phaser.Game(config);