import './style.css'
import Phaser from "phaser"

let game

const CANVAS_WIDTH = 500
const CANVAS_HEIGHT = 500
const TILE_SIZE = 50
const CIRCLE_SIZE = TILE_SIZE / 3
const PLAYER_SPEED = 200
const FIREBALL_SIZE = 30
const DEPTHS = {
  TILES: 0,
  BLOCKS: 10,
  HOVER: 20,
  PLAYER: 30,
  TEXT: 100
}
const TILE_DATA = {
  TILE_TYPE: "TILE_TYPE",
  BLOCK: "BLOCK"
}
const TREE_DATA = {
  HEALTH: "HEALTH"
}
const MONSTER_DATA = {
  IS_AGGRO: "IS_AGGRO"
}
const AGGRO_RADIUS_DATA = {
  MONSTER_REF: "MONSTER_REF"
}
const AGGRO_RADIUS = TILE_SIZE * 3
const MONSTER_SPEED = 100

// Map pixel color to tile id
const PIXEL_TO_TILE = {
  0x41A6F6: 0,
  0xA7F070: 1,
  0x257179: 2,
  0x3B5DC9: 3,
  0xB13E53: 4
}

// This will be filled from map.png
let map = []

let MAP_WIDTH = 0
let MAP_HEIGHT = 0

let PLAYER_POSITION

function gridToWorld(x, y) {
  return {
    x: x * TILE_SIZE,
    y: y * TILE_SIZE
  }
}

// Finds the vector pointing from obj1 to obj2, scaled.
// Returns that vector.
// Assumes that the objects have x and y attributes.
function getVectorBetweenObjects(obj1, obj2, scale = 1) {
  let vec = new Phaser.Math.Vector2(obj2.x - obj1.x, obj2.y - obj1.y)
    .normalize()
    .scale(scale)

  return vec
}


class GameScene extends Phaser.Scene {
  constructor() {
    super("scene-game");
    // Player and Gameplay
    this.player;
    this.playerHealth = 100;
    this.playerIsInvincible = false;
    this.keys;
    this.inventoryCurrHolding = 1;
    this.inventoryText;
    this.inventoryWoodCount = 0;
    this.healthText;
    this.fireball

    // Tiles and Blocks
    this.blockGroup;
    this.treeGroup
    this.hoverBox;
    this.isInvalidPlacement = false;
    this.emitter;

    // Enemies (Monsters)
    this.monsterGroup
    this.monsterRadiusGroup
  }

  preload() {
    this.load.image("tree", "./assets/tree.png")
    this.load.image("tree_particle", "./assets/tree_particle.png")
    this.load.image("map", "./assets/map.png")
    this.load.image("fireball", "./assets/fireball.png")
  }

  buildMapFromImage(textureKey) {
    const sourceImage = this.textures.get(textureKey).getSourceImage()

    const canvas = document.createElement("canvas")
    canvas.width = sourceImage.width
    canvas.height = sourceImage.height

    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(sourceImage, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const result = []

    for (let y = 0; y < canvas.height; y++) {
      const row = []

      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4

        const r = imageData[index]
        const g = imageData[index + 1]
        const b = imageData[index + 2]

        const hex = (r << 16) | (g << 8) | b
        const tileId = PIXEL_TO_TILE[hex]

        if (tileId === undefined) {
          throw new Error(
            `Unknown map color at (${x}, ${y}): 0x${hex.toString(16).toUpperCase().padStart(6, "0")}`
          )
        }

        row.push(tileId)
      }

      result.push(row)
    }

    return result
  }

  animateShake(obj) {
    const objX = obj.x
    const objY = obj.y

    this.tweens.add({
      targets: obj,
      x: objX + 4,
      y: objY - 4,
      duration: 40,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        obj.x = objX;
        obj.y = objY;
      }
    })
  }

  animateBreaking(obj) {
    this.emitter.startFollow(obj)
    this.emitter.start()

    this.animateShake(obj)
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
      if (this.inventoryCurrHolding != 1) {
        return
      }
      if (pointer.rightButtonDown()) { return }
      const treeHealth = tree.getData(TREE_DATA.HEALTH) - 1
      tree.setData(TREE_DATA.HEALTH, treeHealth)

      this.animateBreaking(tree)

      if (treeHealth <= 0) {
        tree.destroy()
        this.animateShake(this.inventoryText)
        this.inventoryWoodCount += 2
        this.updateInventoryText()
      }
    }
    )
    this.treeGroup.add(tree)
  }

  addMonster(x, y) {
    const monsterWorldPos = gridToWorld(x, y)
    const monster = this.add.circle(monsterWorldPos.x, monsterWorldPos.y, CIRCLE_SIZE, 0xDC143C, 1)
    monster.setStrokeStyle(2, 0x000000, 1)
    monster.setDepth(DEPTHS.PLAYER)
    this.physics.add.existing(monster)
    this.monsterGroup.add(monster)
    monster.body.setCollideWorldBounds(true)
    monster.setData(MONSTER_DATA.IS_AGGRO, false)

    const aggroRadius = this.add.circle(monster.x, monster.y, AGGRO_RADIUS, 0, 0)
    this.physics.add.existing(aggroRadius)
    aggroRadius.body.setCircle(AGGRO_RADIUS)
    aggroRadius.setData(AGGRO_RADIUS_DATA.MONSTER_REF, monster)
    this.monsterRadiusGroup.add(aggroRadius)
  }

  onPlayerMonsterCollide(player, monster) {
    if (this.playerIsInvincible) {
      return
    }

    this.playerHealth -= 20
    this.healthText.setText(`HEALTH: ${this.playerHealth}`)
    if (this.playerHealth == 0) {
      resetGame()
    }

    const vec = getVectorBetweenObjects(monster, player, 50)

    this.tweens.add({
      targets: player,
      x: player.x + vec.x,
      y: player.y + vec.y,
      duration: 100,
      ease: "Quad.easeOut"
    })

    this.playerIsInvincible = true
    this.player.setStrokeStyle(2, 0xffffff, 1)
    // this.healthText.setColor("#ff0000")
    this.animateShake(this.healthText)

    this.time.delayedCall(500, () => {
      this.playerIsInvincible = false
      this.player.setStrokeStyle(2, 0x000000, 1)
    })

    // this.time.delayedCall(100, () => {
    //   this.healthText.setColor("#000000")
    // })
  }

  onPlayerEnterMonsterRadius(player, radius) {
    const monster = radius.getData(AGGRO_RADIUS_DATA.MONSTER_REF)
    monster.setData(MONSTER_DATA.IS_AGGRO, true)
  }

  updateInventoryText() {
    let text
    if (this.inventoryCurrHolding == 1) {
      text = `(1) WOOD: ${this.inventoryWoodCount}\n 2  FIREBALL`
    } else if (this.inventoryCurrHolding == 2) {
      text = ` 1  WOOD: ${this.inventoryWoodCount}\n(2) FIREBALL`
    }

    this.inventoryText.setText(text)
  }

  create() {
    // Build map from map.png
    map = this.buildMapFromImage("map")
    MAP_WIDTH = map[0].length * TILE_SIZE
    MAP_HEIGHT = map.length * TILE_SIZE

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

    // Groups
    this.treeGroup = this.physics.add.staticGroup();
    this.blockGroup = this.physics.add.staticGroup();
    this.monsterGroup = this.physics.add.group()
    this.monsterRadiusGroup = this.physics.add.group()

    // Convert map.png to game map data
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

          case 4:
            // Monster
            tileType = "grass"
            color = 0x77DD77
            this.addMonster(col, row)
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
          if (this.inventoryCurrHolding != 1) {
            return
          }

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
            this.blockGroup.add(block)

            this.inventoryWoodCount -= 1
            this.updateInventoryText()
          }
          else if (pointer.leftButtonDown()) {
            const block = tile.getData(TILE_DATA.BLOCK)

            if (block) {
              this.animateBreaking(block)

              this.inventoryWoodCount += 1
              this.updateInventoryText()
              this.animateShake(this.inventoryText)
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
    this.player = this.add.circle(playerWorld.x, playerWorld.y, CIRCLE_SIZE, 0x2b3faf, 1)
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

    // Text
    this.inventoryText = this.add.text(20, CANVAS_HEIGHT - 60, "", {
      font: "25px Monospace",
      fill: "#000000"
    }).setScrollFactor(0) // Set dont move with camera
      .setDepth(DEPTHS.TEXT)
    this.updateInventoryText()

    this.healthText = this.add.text(20, 20, "HEALTH: 100", {
      font: "25px Monospace",
      fill: "#000000"
    }).setScrollFactor(0) // Set dont move with camera
      .setDepth(DEPTHS.TEXT)

    // Controls
    this.keys = this.input.keyboard.addKeys(
      "W,A,S,D,LEFT,RIGHT,UP,DOWN,R,ONE,TWO"
    )

    // Fireball
    this.fireball = this.add.image(this.player.x, this.player.y, "fireball")
      .setDepth(DEPTHS.PLAYER)
      .setDisplaySize(FIREBALL_SIZE, FIREBALL_SIZE)
    this.textures.get("fireball").setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.physics.add.existing(this.fireball)
    this.fireball.setVisible(false)
    this.fireball.body.enable = false

    // Collision
    this.player.body.setCollideWorldBounds(true)
    this.physics.add.collider(this.player, this.blockGroup)
    this.physics.add.collider(this.player, this.treeGroup)
    this.physics.add.collider(this.player, this.monsterGroup, this.onPlayerMonsterCollide, null, this)
    this.physics.add.collider(this.monsterGroup, this.blockGroup)
    this.physics.add.collider(this.monsterGroup, this.treeGroup)
    this.physics.add.overlap(this.player, this.monsterRadiusGroup, this.onPlayerEnterMonsterRadius, null, this)

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
    // Reset button
    if (this.keys.R.isDown) {
      resetGame()
    }

    // Player movement
    const isUp = this.keys.UP.isDown || this.keys.W.isDown
    const isLeft = this.keys.LEFT.isDown || this.keys.A.isDown
    const isDown = this.keys.DOWN.isDown || this.keys.S.isDown
    const isRight = this.keys.RIGHT.isDown || this.keys.D.isDown

    let velocityX = 0;
    let velocityY = 0;

    if (isLeft) {
      velocityX = -1
    } else if (isRight) {
      velocityX = 1
    }

    if (isUp) {
      velocityY = -1
    } else if (isDown) {
      velocityY = 1
    }

    const vec = new Phaser.Math.Vector2(velocityX, velocityY)
      .normalize()
      .scale(PLAYER_SPEED)

    this.player.body.setVelocity(vec.x, vec.y);

    // Update currently holding
    if (this.keys.ONE.isDown) {
      this.inventoryCurrHolding = 1
    } else if (this.keys.TWO.isDown) {
      this.inventoryCurrHolding = 2
    }
    this.updateInventoryText()

    // Block placement
    if (this.physics.overlap(this.player, this.hoverBox)
      || this.physics.overlap(this.treeGroup, this.hoverBox)
      || this.physics.overlap(this.monsterGroup, this.hoverBox)) {
      this.isInvalidPlacement = true
    } else {
      this.isInvalidPlacement = false
    }

    // Update monster
    this.monsterGroup.children.each((monster) => {
      if (monster.getData(MONSTER_DATA.IS_AGGRO)) {
        const monsterVec = getVectorBetweenObjects(monster, this.player, MONSTER_SPEED)

        monster.body.setVelocity(monsterVec.x, monsterVec.y)
      }
    })
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
      debug: true,
    },
  },
  // pixelArt: true,
  scene: [GameScene],
};

game = new Phaser.Game(config);

function resetGame() {
  game.destroy(false)
  game = new Phaser.Game(config);
}