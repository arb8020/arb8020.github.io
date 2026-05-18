#include <emscripten/emscripten.h>
#include <time.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "breakout.h"

static Breakout env;

// Override c_render to skip texture loading (use simple rectangle for ball)
void c_render_web(Breakout* e) {
    if (e->client == NULL) {
        e->client = make_client(e);
    }

    BeginDrawing();
    ClearBackground((Color){6, 24, 24, 255});

    // Paddle
    DrawRectangle(e->paddle_x, e->paddle_y,
        e->paddle_width, e->paddle_height, (Color){0, 255, 255, 255});

    // Ball — simple bright rectangle instead of texture
    DrawRectangle(e->ball_x, e->ball_y,
        e->ball_width, e->ball_height, WHITE);

    // Bricks
    Color BRICK_COLORS[6] = {RED, ORANGE, YELLOW, GREEN, SKYBLUE, BLUE};
    for (int row = 0; row < e->brick_rows; row++) {
        for (int col = 0; col < e->brick_cols; col++) {
            int idx = row * e->brick_cols + col;
            if (e->brick_states[idx] == 1) continue;
            DrawRectangle(e->brick_x[idx], e->brick_y[idx],
                e->brick_width - 1, e->brick_height - 1, BRICK_COLORS[row]);
        }
    }

    // HUD
    DrawText(TextFormat("Score: %i", e->score), 10, 10, 20, WHITE);
    DrawText(TextFormat("Balls: %i", e->num_balls), e->width - 100, 10, 20, WHITE);
    EndDrawing();
}

void game_frame(void) {
    env.actions[0] = NOOP;
    if (IsKeyDown(KEY_LEFT)  || IsKeyDown(KEY_A)) env.actions[0] = LEFT;
    if (IsKeyDown(KEY_RIGHT) || IsKeyDown(KEY_D)) env.actions[0] = RIGHT;

    c_step(&env);
    c_render_web(&env);
}

int main(void) {
    srand(time(NULL));

    env = (Breakout){
        .num_agents = 1,
        .frameskip = 1,
        .width = 576,
        .height = 330,
        .initial_paddle_width = 62,
        .paddle_width = 62,
        .paddle_height = 8,
        .ball_width = 12,
        .ball_height = 12,
        .brick_width = 32,
        .brick_height = 12,
        .brick_rows = 6,
        .brick_cols = 18,
        .initial_ball_speed = 256,
        .max_ball_speed = 448,
        .paddle_speed = 620,
        .continuous = 0,
    };
    allocate(&env);
    c_reset(&env);

    env.client = make_client(&env);
    SetTargetFPS(60);

    emscripten_set_main_loop(game_frame, 60, 1);

    close_client(env.client);
    free_allocated(&env);
    return 0;
}
