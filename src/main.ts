import './style.css';
import Phaser from 'phaser';

type GridPosition = { x: number; y: number };
type TileId = 0 | 1 | 2 | 3 | 4;
type TileType = 'water' | 'grass' | 'monsterSpawn';
type HasXY = { x: number; y: number };

type ArcadeBody = Phaser.Physics.Arcade.Body;
type StaticArcadeBody = Phaser.Physics.Arcade.StaticBody;
type ArcWithBody = Phaser.GameObjects.Arc & { body: ArcadeBody };
type ImageWithBody = Phaser.GameObjects.Image & { body: ArcadeBody };
type RectangleWithBody = Phaser.GameObjects.Rectangle & {
  body: ArcadeBody | StaticArcadeBody;
};
type KeyMap = Record<string, Phaser.Input.Keyboard.Key>;

type TransformGameObject =
  Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Transform;

type ArcadeCollisionObject =
  | Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile;

let game: Phaser.Game;

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 500;
const TILE_SIZE = 50;
const CIRCLE_SIZE = TILE_SIZE / 3;
const PLAYER_SPEED = 200;
const FIREBALL_SIZE = 50;
const FIREBALL_SPEED = 500;

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

const MONSTER_DATA = {
  IS_AGGRO: 'IS_AGGRO',
  HEALTH: 'HEALTH',
} as const;

const AGGRO_RADIUS_DATA = {
  MONSTER_REF: 'MONSTER_REF',
} as const;

const AGGRO_RADIUS = TILE_SIZE * 6;
const MONSTER_SPEED = 100;

// Map pixel color to tile id.
const PIXEL_TO_TILE: Record<number, TileId> = {
  0x41a6f6: 0,
  0xa7f070: 1,
  0x257179: 2,
  0x3b5dc9: 3,
  0xb13e53: 4,
};

const NEXT_WAVE_SECONDS = 10;
const MONSTER_HEALTH = 60;

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
function getVectorBetweenObjects(
  obj1: HasXY,
  obj2: HasXY,
  scale = 1,
): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(obj2.x - obj1.x, obj2.y - obj1.y)
    .normalize()
    .scale(scale);
}

class GameScene extends Phaser.Scene {
  // Player and gameplay
  private player!: ArcWithBody;
  private playerHealth = 100;
  private playerIsInvincible = false;
  private keys!: KeyMap;
  private fireball!: ImageWithBody;
  private fireballIsCooldown = false;

  // UI
  private inventoryCurrHolding = 1;
  private inventoryText!: Phaser.GameObjects.Text;
  private inventoryWoodCount = 0;
  private healthText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private waveNum = 1;
  private waveMonsterCurrNum = 3;
  private waveMonsterMaxNum = 3;
  private isWaveActive = true;
  private waveCountdown: Phaser.Time.TimerEvent | null = null;
  private timeNextWave = '0';

  // Tiles and blocks
  private blockGroup!: Phaser.Physics.Arcade.StaticGroup;
  private treeGroup!: Phaser.Physics.Arcade.StaticGroup;
  private hoverBox!: RectangleWithBody;
  private isInvalidPlacement = false;
  private emitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private monsterTiles: Array<[number, number]> = [];

  // Enemies / monsters
  private monsterGroup!: Phaser.Physics.Arcade.Group;
  private monsterRadiusGroup!: Phaser.Physics.Arcade.Group;

  constructor() {
    super('scene-game');
  }

  preload(): void {
    this.load.image('tree', './assets/tree.png');
    this.load.image('tree_particle', './assets/tree_particle.png');
    this.load.image('map', './assets/map.png');
    this.load.image('fireball', './assets/fireball.png');
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

  private addMonster(x: number, y: number): void {
    const monsterWorldPos = gridToWorld(x, y);
    const monster = this.add.circle(
      monsterWorldPos.x,
      monsterWorldPos.y,
      CIRCLE_SIZE,
      0xdc143c,
      1,
    ) as ArcWithBody;

    monster.setStrokeStyle(2, 0x000000, 1);
    monster.setDepth(DEPTHS.PLAYER);
    this.physics.add.existing(monster);
    this.monsterGroup.add(monster);
    monster.body.setCollideWorldBounds(true);
    monster.setData(MONSTER_DATA.IS_AGGRO, false);
    monster.setData(MONSTER_DATA.HEALTH, MONSTER_HEALTH);

    const aggroRadius = this.add.circle(monster.x, monster.y, AGGRO_RADIUS, 0, 0) as ArcWithBody;
    this.physics.add.existing(aggroRadius);
    aggroRadius.body.setCircle(AGGRO_RADIUS);
    aggroRadius.setData(AGGRO_RADIUS_DATA.MONSTER_REF, monster);
    this.monsterRadiusGroup.add(aggroRadius);
  }

  private onPlayerMonsterCollide(
    playerObject: ArcadeCollisionObject,
    monsterObject: ArcadeCollisionObject,
  ): void {
    const player = playerObject as unknown as ArcWithBody;
    const monster = monsterObject as unknown as ArcWithBody;

    if (this.playerIsInvincible) {
      return;
    }

    this.playerHealth -= 20;
    this.healthText.setText(`HEALTH: ${this.playerHealth}`);

    if (this.playerHealth <= 0) {
      resetGame();
      return;
    }

    const vec = getVectorBetweenObjects(monster, player, 50);

    this.tweens.add({
      targets: player,
      x: player.x + vec.x,
      y: player.y + vec.y,
      duration: 100,
      ease: 'Quad.easeOut',
    });

    this.playerIsInvincible = true;
    this.player.setStrokeStyle(2, 0xffffff, 1);
    this.animateShake(this.healthText);

    this.time.delayedCall(500, () => {
      this.playerIsInvincible = false;
      this.player.setStrokeStyle(2, 0x000000, 1);
    });
  }

  private onPlayerEnterMonsterRadius(
    _playerObject: ArcadeCollisionObject,
    radiusObject: ArcadeCollisionObject,
  ): void {
    const radius = radiusObject as unknown as ArcWithBody;
    const monster = radius.getData(AGGRO_RADIUS_DATA.MONSTER_REF) as ArcWithBody;

    monster.setData(MONSTER_DATA.IS_AGGRO, true);
  }

  // Group vs Sprite exception:
  // the two objects are passed in the same order you specified, unless you are
  // colliding Group vs Sprite, in which case Sprite is always the first parameter.
  private onMonsterFireballCollide(
    fireballObject: ArcadeCollisionObject,
    monsterObject: ArcadeCollisionObject,
  ): void {
    const fireball = fireballObject as unknown as ImageWithBody;
    const monster = monsterObject as unknown as ArcWithBody;

    monster.setData(MONSTER_DATA.IS_AGGRO, true);

    const monsterHealth = (monster.getData(MONSTER_DATA.HEALTH) as number) - 20;
    monster.setData(MONSTER_DATA.HEALTH, monsterHealth);

    fireball.setVisible(false);
    fireball.body.enable = false;

    const vec = new Phaser.Math.Vector2().setToPolar(fireball.rotation, 50);

    this.tweens.add({
      targets: monster,
      x: monster.x + vec.x,
      y: monster.y + vec.y,
      duration: 100,
      ease: 'Quad.easeOut',
    });

    monster.setStrokeStyle(2, 0xffffff, 1);
    this.time.delayedCall(300, () => {
      monster.setStrokeStyle(2, 0x000000, 1);
    });

    if (monsterHealth <= 0) {
      monster.destroy();
      this.waveMonsterCurrNum -= 1;

      if (this.waveMonsterCurrNum <= 0) {
        this.endWave();
      }
    }
  }

  private endWave(): void {
    this.waveNum += 1;
    this.isWaveActive = false;

    this.waveCountdown = this.time.addEvent({
      delay: NEXT_WAVE_SECONDS * 1000,
      callback: () => {
        this.startWave();
      },
      callbackScope: this,
    });
  }

  private startWave(): void {
    this.isWaveActive = true;
    this.updateWaveText();

    this.waveMonsterMaxNum = Math.min(this.waveNum * 3, this.monsterTiles.length);
    this.waveMonsterCurrNum = this.waveMonsterMaxNum;

    Phaser.Utils.Array.Shuffle(this.monsterTiles);

    let monsterCount = 0;
    for (const tile of this.monsterTiles) {
      if (monsterCount >= this.waveMonsterMaxNum) {
        break;
      }

      this.addMonster(tile[0], tile[1]);
      monsterCount += 1;
    }
  }

  private updateInventoryText(): void {
    let text = '';

    if (this.inventoryCurrHolding === 1) {
      text = `(1) WOOD: ${this.inventoryWoodCount}\n 2  FIREBALL`;
    } else if (this.inventoryCurrHolding === 2) {
      text = ` 1  WOOD: ${this.inventoryWoodCount}\n(2) FIREBALL`;
    }

    this.inventoryText.setText(text);
  }

  private updateWaveText(): void {
    const text = this.isWaveActive
      ? `Wave ${this.waveNum}`
      : `Time next wave: ${this.timeNextWave.padStart(2, ' ')}`;

    this.waveText.setText(text);
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
    this.monsterGroup = this.physics.add.group();
    this.monsterRadiusGroup = this.physics.add.group();

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

          case 4:
            // Monster
            tileType = 'monsterSpawn';
            color = 0x5cb85c;
            this.monsterTiles.push([col, row]);
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

    this.healthText = this.add
      .text(20, 20, 'HEALTH: 100', {
        font: '25px Monospace',
        color: '#000000',
      })
      .setScrollFactor(0)
      .setDepth(DEPTHS.TEXT);

    this.waveText = this.add
      .text(CANVAS_WIDTH - 20, 20, 'Wave 1', {
        font: '25px Monospace',
        color: '#000000',
      })
      .setScrollFactor(0)
      .setDepth(DEPTHS.TEXT)
      .setOrigin(1, 0);

    // Controls.
    this.keys = this.input.keyboard!.addKeys(
      'W,A,S,D,LEFT,RIGHT,UP,DOWN,R,ONE,TWO,X',
    ) as KeyMap;

    // Fireball.
    this.fireball = this.add
      .image(this.player.x, this.player.y, 'fireball')
      .setDepth(DEPTHS.PLAYER)
      .setDisplaySize(FIREBALL_SIZE, FIREBALL_SIZE) as ImageWithBody;

    this.textures.get('fireball').setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.physics.add.existing(this.fireball);
    this.fireball.setVisible(false);
    this.fireball.body.enable = false;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (
        this.inventoryCurrHolding !== 2 ||
        !pointer.leftButtonDown() ||
        this.fireballIsCooldown
      ) {
        return;
      }

      const activePointer = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const pointerVec = getVectorBetweenObjects(this.player, activePointer, FIREBALL_SPEED);

      this.fireball.setRotation(pointerVec.angle());
      this.fireball.setPosition(this.player.x, this.player.y);
      this.fireball.body.setVelocity(pointerVec.x, pointerVec.y);

      this.fireball.setVisible(true);
      this.fireball.body.enable = true;
      this.fireballIsCooldown = true;

      // Fireball cooldown.
      this.time.delayedCall(500, () => {
        this.fireballIsCooldown = false;
        this.fireball.setVisible(false);
        this.fireball.body.enable = false;
      });
    });

    // Collision.
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.blockGroup);
    this.physics.add.collider(this.player, this.treeGroup);
    this.physics.add.collider(this.player, this.monsterGroup, this.onPlayerMonsterCollide, undefined, this);
    this.physics.add.collider(this.monsterGroup, this.blockGroup);
    this.physics.add.collider(this.monsterGroup, this.monsterGroup);
    this.physics.add.collider(this.monsterGroup, this.treeGroup);
    this.physics.add.overlap(this.monsterGroup, this.fireball, this.onMonsterFireballCollide, undefined, this);
    this.physics.add.overlap(this.player, this.monsterRadiusGroup, this.onPlayerEnterMonsterRadius, undefined, this);
    this.physics.add.collider(this.fireball, this.blockGroup);

    // Camera.
    this.cameras.main.setBounds(-TILE_SIZE / 2, -TILE_SIZE / 2, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.startFollow(this.player, true);
    this.cameras.main.setZoom(1);

    this.startWave();
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
    } else if (this.keys.TWO.isDown) {
      this.inventoryCurrHolding = 2;
    }
    this.updateInventoryText();

    // Block placement.
    this.isInvalidPlacement =
      this.physics.overlap(this.player, this.hoverBox) ||
      this.physics.overlap(this.treeGroup, this.hoverBox) ||
      this.physics.overlap(this.monsterGroup, this.hoverBox);

    // Update monsters.
    this.monsterGroup.getChildren().forEach((monsterObject: Phaser.GameObjects.GameObject) => {
      const monster = monsterObject as ArcWithBody;

      if (monster.getData(MONSTER_DATA.IS_AGGRO) as boolean) {
        const monsterVec = getVectorBetweenObjects(monster, this.player, MONSTER_SPEED);
        monster.body.setVelocity(monsterVec.x, monsterVec.y);
      }
    });

    // Update wave text.
    if (!this.isWaveActive && this.waveCountdown) {
      this.timeNextWave = this.waveCountdown.getRemainingSeconds().toFixed(0);
      this.updateWaveText();
    }
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
