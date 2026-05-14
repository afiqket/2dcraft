import './style.css';
import Phaser from 'phaser';

type GridPosition = { x: number; y: number };
type TileId = 0 | 1 | 2 | 3 | 4;
type TileType = 'water' | 'grass';
type HasXY = { x: number; y: number };

type ArcadeBody = Phaser.Physics.Arcade.Body;
type StaticArcadeBody = Phaser.Physics.Arcade.StaticBody;
type ArcWithBody = Phaser.GameObjects.Arc & { body: ArcadeBody };
// type ImageWithBody = Phaser.GameObjects.Image & { body: ArcadeBody };
type RectangleWithBody = Phaser.GameObjects.Rectangle & {
  body: ArcadeBody | StaticArcadeBody;
};
type KeyMap = Record<string, Phaser.Input.Keyboard.Key>;

type TransformGameObject =
  Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Transform;

// type ArcadeCollisionObject =
//   | Phaser.Types.Physics.Arcade.GameObjectWithBody
//   | Phaser.Physics.Arcade.Body
//   | Phaser.Physics.Arcade.StaticBody
//   | Phaser.Tilemaps.Tile;

let game: Phaser.Game;

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 500;
const TILE_SIZE = 50;
const CIRCLE_SIZE = TILE_SIZE / 3;
const PLAYER_SPEED = 200;

const DEPTHS = {
  TILES: 0,
  BLOCKS: 10,
  HOVER: 20,
  PLAYER: 30,
  TEXT: 100,
} as const;

const TILE_DATA = {
  TILE_TYPE: 'TILE_TYPE',
  BLOCK: 'BLOCK',
  HOVER_BOX: 'HOVER_BOX',
} as const;

const TREE_DATA = {
  HEALTH: 'HEALTH',
} as const;

// Map pixel color to tile id.
const PIXEL_TO_TILE: Record<number, TileId> = {
  0x41a6f6: 0,
  0xa7f070: 1,
  0x257179: 2,
  0x3b5dc9: 3,
  0xb13e53: 4,
};

// This will be filled from map.png.
let map: TileId[][] = [];

let MAP_WIDTH = 0;
let MAP_HEIGHT = 0;

let PLAYER_POSITION: GridPosition | null = null;

function gridToWorld(x: number, y: number): GridPosition {
  return {
    x: x * TILE_SIZE,
    y: y * TILE_SIZE,
  };
}

// Finds the vector pointing from obj1 to obj2, scaled.
// Assumes that the objects have x and y attributes.
// function getVectorBetweenObjects(
//   obj1: HasXY,
//   obj2: HasXY,
//   scale = 1,
// ): Phaser.Math.Vector2 {
//   return new Phaser.Math.Vector2(obj2.x - obj1.x, obj2.y - obj1.y)
//     .normalize()
//     .scale(scale);
// }

class GameScene extends Phaser.Scene {
  // Player and gameplay
  private player!: ArcWithBody;
  private keys!: KeyMap;

  // UI
  private inventoryCurrHolding = 1;
  private inventoryText!: Phaser.GameObjects.Text;
  private inventoryWoodCount = 0;

  // Tiles and blocks
  private blockGroup!: Phaser.Physics.Arcade.StaticGroup;
  private treeGroup!: Phaser.Physics.Arcade.StaticGroup;
  private hoverBox!: RectangleWithBody;
  private isInvalidPlacement = false;
  private emitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('scene-game');
  }

  preload(): void {
    this.load.image('tree', './assets/tree.png');
    this.load.image('tree_particle', './assets/tree_particle.png');
    this.load.image('map', './assets/map.png');
  }

  private buildMapFromImage(textureKey: string): TileId[][] {
    const sourceImage = this.textures
      .get(textureKey)
      .getSourceImage() as HTMLImageElement | HTMLCanvasElement;

    const canvas = document.createElement('canvas');
    canvas.width = sourceImage.width;
    canvas.height = sourceImage.height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Could not create 2D canvas context.');
    }

    ctx.drawImage(sourceImage, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const result: TileId[][] = [];

    for (let y = 0; y < canvas.height; y++) {
      const row: TileId[] = [];

      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;

        const r = imageData[index];
        const g = imageData[index + 1];
        const b = imageData[index + 2];

        const hex = (r << 16) | (g << 8) | b;
        const tileId = PIXEL_TO_TILE[hex];

        if (tileId === undefined) {
          throw new Error(
            `Unknown map color at (${x}, ${y}): 0x${hex
              .toString(16)
              .toUpperCase()
              .padStart(6, '0')}`,
          );
        }

        row.push(tileId);
      }

      result.push(row);
    }

    return result;
  }

  private animateShake(obj: TransformGameObject): void {
    const objX = obj.x;
    const objY = obj.y;

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
      },
    });
  }

  private animateBreaking(obj: TransformGameObject): void {
    this.emitter.startFollow(obj);
    this.emitter.start();

    this.animateShake(obj);
  }

  private addTree(x: number, y: number): void {
    const treeWorld = gridToWorld(x, y);
    const tree = this.add
      .image(treeWorld.x, treeWorld.y, 'tree')
      .setDepth(DEPTHS.BLOCKS)
      .setDisplaySize(TILE_SIZE, TILE_SIZE);

    this.textures.get('tree').setFilter(Phaser.Textures.FilterMode.NEAREST);
    tree.setData(TREE_DATA.HEALTH, 3);
    tree.setInteractive();

    tree.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.inventoryCurrHolding !== 1) {
        return;
      }

      if (pointer.rightButtonDown()) {
        return;
      }

      const treeHealth = (tree.getData(TREE_DATA.HEALTH) as number) - 1;
      tree.setData(TREE_DATA.HEALTH, treeHealth);

      this.animateBreaking(tree);

      if (treeHealth <= 0) {
        tree.destroy();
        this.animateShake(this.inventoryText);
        this.inventoryWoodCount += 2;
        this.updateInventoryText();
      }
    });

    this.treeGroup.add(tree);
  }


  private updateInventoryText(): void {
    let text = '';

    if (this.inventoryCurrHolding === 1) {
      text = `(1) WOOD: ${this.inventoryWoodCount}`;
    }

    this.inventoryText.setText(text);
  }

  create(): void {
    // Build map from map.png.
    map = this.buildMapFromImage('map');
    MAP_WIDTH = map[0].length * TILE_SIZE;
    MAP_HEIGHT = map.length * TILE_SIZE;

    // Disable normal right click.
    this.input.mouse?.disableContextMenu();

    // Map bounds.
    this.physics.world.setBounds(-TILE_SIZE / 2, -TILE_SIZE / 2, MAP_WIDTH, MAP_HEIGHT);

    // Groups must exist before addTree() is called.
    this.treeGroup = this.physics.add.staticGroup();
    this.blockGroup = this.physics.add.staticGroup();

    // Red outline box when a tile is hovered.
    this.hoverBox = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0x000000, 0) as RectangleWithBody;
    this.hoverBox
      .setStrokeStyle(2, 0xff0000, 1)
      .setDepth(DEPTHS.HOVER)
      .setVisible(false);

    this.physics.add.existing(this.hoverBox, true);

    // Convert map.png to game map data.
    for (let row = 0; row < map.length; row++) {
      for (let col = 0; col < map[row].length; col++) {
        const tileId = map[row][col];
        let tileType: TileType = 'grass';
        let color = 0x77dd77;

        switch (tileId) {
          case 0:
            // Water
            tileType = 'water';
            color = 0x4f92d4;
            break;

          case 1:
          case 4:
            // Grass
            tileType = 'grass';
            color = 0x77dd77;
            break;

          case 2:
            // Tree
            tileType = 'grass';
            color = 0x77dd77;
            this.addTree(col, row);
            break;

          case 3:
            // Player
            tileType = 'grass';
            color = 0x77dd77;
            PLAYER_POSITION = { x: col, y: row };
            break;
        }

        const { x, y } = gridToWorld(col, row);

        const tile = this.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, color, 1) as RectangleWithBody;
        tile.setStrokeStyle(1, 0x444444, 1);

        this.physics.add.existing(tile, true);

        tile.setData(TILE_DATA.TILE_TYPE, tileType);
        tile.setData(TILE_DATA.BLOCK, null);
        tile.setData(TILE_DATA.HOVER_BOX, null);

        // Required for mouse click events.
        tile.setInteractive();

        tile.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          if (this.inventoryCurrHolding !== 1) {
            return;
          }

          if (pointer.rightButtonDown()) {
            if (
              tile.getData(TILE_DATA.BLOCK) ||
              this.isInvalidPlacement ||
              this.inventoryWoodCount === 0
            ) {
              return;
            }

            const block = this.add
              .rectangle(tile.x, tile.y, TILE_SIZE, TILE_SIZE, 0x895129, 1)
              .setDepth(DEPTHS.BLOCKS) as RectangleWithBody;

            tile.setData(TILE_DATA.BLOCK, block);

            this.physics.add.existing(block, true);
            this.blockGroup.add(block);

            this.inventoryWoodCount -= 1;
            this.updateInventoryText();
          } else if (pointer.leftButtonDown()) {
            const block = tile.getData(TILE_DATA.BLOCK) as RectangleWithBody | null;

            if (block) {
              this.animateBreaking(block);

              this.inventoryWoodCount += 1;
              this.updateInventoryText();
              this.animateShake(this.inventoryText);
              block.destroy();
              tile.setData(TILE_DATA.BLOCK, null);
            }
          }
        });

        tile.on('pointerover', () => {
          this.hoverBox.setPosition(tile.x, tile.y);
          this.hoverBox.setVisible(true);
          this.hoverBox.body.updateFromGameObject();
        });

        tile.on('pointerout', () => {
          this.hoverBox.setVisible(false);
        });

        tile.setDepth(DEPTHS.TILES);
      }
    }

    if (!PLAYER_POSITION) {
      throw new Error('No player spawn tile found in map.png. Use color 0x3B5DC9.');
    }

    // Player.
    const playerWorld = gridToWorld(PLAYER_POSITION.x, PLAYER_POSITION.y);
    this.player = this.add.circle(playerWorld.x, playerWorld.y, CIRCLE_SIZE, 0x2b3faf, 1) as ArcWithBody;
    this.player.setStrokeStyle(2, 0x000000, 1);
    this.player.setDepth(DEPTHS.PLAYER);
    this.physics.add.existing(this.player);

    // Effects.
    this.emitter = this.add
      .particles(0, 0, 'tree_particle', {
        speed: 300,
        lifespan: 150,
        gravityY: 1000,
        scale: 1,
        duration: 100,
        emitting: false,
      })
      .setDepth(DEPTHS.PLAYER);

    // Text.
    this.inventoryText = this.add
      .text(20, CANVAS_HEIGHT - 60, '', {
        font: '25px Monospace',
        color: '#000000',
      })
      .setScrollFactor(0)
      .setDepth(DEPTHS.TEXT);
    this.updateInventoryText();

    // Controls.
    this.keys = this.input.keyboard!.addKeys(
      'W,A,S,D,LEFT,RIGHT,UP,DOWN,R,ONE,X',
    ) as KeyMap;

    // Collision.
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.blockGroup);
    this.physics.add.collider(this.player, this.treeGroup);

    // Camera.
    this.cameras.main.setBounds(-TILE_SIZE / 2, -TILE_SIZE / 2, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.startFollow(this.player, true);
    this.cameras.main.setZoom(1);
  }

  update(): void {
    // Reset button.
    if (this.keys.R.isDown) {
      resetGame();
      return;
    }

    // Player movement.
    const isUp = this.keys.UP.isDown || this.keys.W.isDown;
    const isLeft = this.keys.LEFT.isDown || this.keys.A.isDown;
    const isDown = this.keys.DOWN.isDown || this.keys.S.isDown;
    const isRight = this.keys.RIGHT.isDown || this.keys.D.isDown;

    let velocityX = 0;
    let velocityY = 0;

    if (isLeft) {
      velocityX = -1;
    } else if (isRight) {
      velocityX = 1;
    }

    if (isUp) {
      velocityY = -1;
    } else if (isDown) {
      velocityY = 1;
    }

    const vec = new Phaser.Math.Vector2(velocityX, velocityY)
      .normalize()
      .scale(PLAYER_SPEED);

    this.player.body.setVelocity(vec.x, vec.y);

    // Update currently holding.
    if (this.keys.ONE.isDown) {
      this.inventoryCurrHolding = 1;
    }
    this.updateInventoryText();

    // Block placement.
    this.isInvalidPlacement =
      this.physics.overlap(this.player, this.hoverBox) ||
      this.physics.overlap(this.treeGroup, this.hoverBox);

  }
}

const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  ...(gameCanvas ? { canvas: gameCanvas } : {}),
  physics: {
    default: 'arcade',
    arcade: {
      // debug: true,
    },
  },
  scene: [GameScene],
};

game = new Phaser.Game(config);

function resetGame(): void {
  game.destroy(false);
  game = new Phaser.Game(config);
}
