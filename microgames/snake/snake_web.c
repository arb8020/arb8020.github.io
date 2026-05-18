#include <emscripten/emscripten.h>
#include <time.h>
#include <stdlib.h>
#include <string.h>

// Pull in the game logic + raylib rendering
#include "snake.h"

static CSnake env;

void game_frame(void) {
    // Keyboard input for player 1 (WASD or arrows)
    if (IsKeyDown(KEY_UP)    || IsKeyDown(KEY_W)) env.actions[0] = 0;
    if (IsKeyDown(KEY_DOWN)  || IsKeyDown(KEY_S)) env.actions[0] = 1;
    if (IsKeyDown(KEY_LEFT)  || IsKeyDown(KEY_A)) env.actions[0] = 2;
    if (IsKeyDown(KEY_RIGHT) || IsKeyDown(KEY_D)) env.actions[0] = 3;

    // All other snakes get random actions
    for (int i = 1; i < env.num_agents; i++) {
        env.actions[i] = rand() % 4;
    }

    c_step(&env);
    c_render(&env);
}

int main(void) {
    srand(time(NULL));

    env = (CSnake){
        .num_agents = 16,
        .width = 80,
        .height = 45,
        .max_snake_length = 200,
        .food = 64,
        .vision = 5,
        .leave_corpse_on_death = 1,
        .reward_food = 1.0f,
        .reward_corpse = 0.5f,
        .reward_death = -1.0f,
        .cell_size = 12,
    };
    allocate_csnake(&env);
    c_reset(&env);

    // Create raylib window — emscripten will size to canvas
    env.client = make_client(env.cell_size, env.width, env.height);

    emscripten_set_main_loop(game_frame, 15, 1);

    // Cleanup (never reached in emscripten, but good form)
    close_client(env.client);
    free_csnake(&env);
    return 0;
}
