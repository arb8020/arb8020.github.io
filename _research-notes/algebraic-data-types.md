---
layout: post
title: "algebraic data types"
date: 2025-09-18
slug: algebraic-data-types
---

<!-- TODO: Add introduction explaining what ADTs are and why they matter before diving into implementation
     Feedback: "The document really teaches 'implementing ADTs from scratch in Python' - the motivation is assumed rather than explained. A reader who doesn't already know why ADTs matter won't find that motivation here. Consider adding a brief intro explaining what problems ADTs solve at a high level before diving into implementation."
     Suggestion: "Add a 'Why Should You Care?' section - Start with a real problem that's painful without ADTs, then show how they solve it" -->

**motivating product types**

i'm writing graphics code, and i want to go from an empty screen, to a display
let's assume that for some screen bytearray, we have a 'render' function
this function takes the value of the byte ([0,255]), and for the corresponding pixel, fills in the corresponding amount of 'white' (0 is black, 255 is full white)
lets say that the size of this screen is fixed, at 256 x 256
so the bytearray is len(256 * 256) = 65536

``` 
memory = bytearray(1000000)
SCREEN_WIDTH = 256
SCREEN_HEIGHT = 256
``` 
for simplicity, let's say that our memory model is that anything in the range 
[0,65535] of the bytearray will get rendered, and the rest is our program space

i want to draw a shape on the screen, but all i have is the ability to update the memory
i'd like to start off my picture by drawing a sun in the top right
to set the first pixel in the top right, to white
i know that the right side of the screen would be 255 pixels to the right
and the top of the screen is 0 pixels from the top
so i can simply write

`memory[255] = 255`

great! but now i want to draw a full sun, not just one pixel
let me try to draw a small 3x3 sun:

```python
memory[240 + 15 * 256] = 255  # center
memory[239 + 15 * 256] = 200  # left
memory[241 + 15 * 256] = 200  # right
memory[240 + 14 * 256] = 200  # top
memory[240 + 16 * 256] = 200  # bottom
```

this is getting really annoying to type, especially without a tab complete
let me try to track the sun's position a bit more carefully
let's make a variable for where our variable space begins, to make sure we don't interfere with the screen

```python
<!-- TODO: Delete the whole "manual offset" prelude
     Feedback: "KILL (≈ 220 words): sun_x_addr = VAR_SPACE_OFFSET + 0... Nobody needs to see you suffer through hand-counting once you immediately show alloc_u8() two screens later." -->
VAR_SPACE_OFFSET = 65536
sun_x_addr = VAR_SPACE_OFFSET + 0
sun_y_addr = VAR_SPACE_OFFSET + 1
sun_brightness_addr = VAR_SPACE_OFFSET + 2

memory[sun_x_addr] = 240
memory[sun_y_addr] = 15
memory[sun_brightness_addr] = 255
```

ok, this isn't so bad
now i want to add some stars. let me allocate space for them:

```python
<!-- TODO: Collapse the three allocation helpers into one code block
     Feedback: "KILL the narrative between the first alloc_u8 and the first set_pixel call (≈ 180 words)." -->
star1_x_addr = VAR_SPACE_OFFSET + 3
star1_y_addr = VAR_SPACE_OFFSET + 4
star1_brightness_addr = VAR_SPACE_OFFSET + 5

star2_x_addr = VAR_SPACE_OFFSET + 6
star2_y_addr = VAR_SPACE_OFFSET + 7
star2_brightness_addr = VAR_SPACE_OFFSET + 8
```

this is insane, i have to manually track these increasing offsets
let me make this easier with some allocation helpers:

```python
next_free = 0

def alloc_u8():
    global next_free
    offset = next_free
    next_free += 1
    return offset

def write_u8(offset, value):
    memory[VAR_SPACE_OFFSET + offset] = value

def read_u8(offset):
    return memory[VAR_SPACE_OFFSET + offset]

<!-- TODO: Add bounds checking and error handling for buffer access
     Feedback: "set_pixel(x, y, colour) silently assumes x, y in bounds; either assert or mention the cost of defensive checks" -->
def set_pixel(x, y, color):
    memory[x + y * 256] = color
```

ok, now i can write:

```python
star_x = alloc_u8()  # offset 0
star_y = alloc_u8()  # offset 1
star_brightness = alloc_u8()  # offset 2

write_u8(star_x, 240)
write_u8(star_y, 15)
write_u8(star_brightness, 255)

x = read_u8(star_x)
y = read_u8(star_y)
brightness = read_u8(star_brightness)
set_pixel(x, y, brightness)
```

ok this is better, but it still a bit inconvenient that i have to read/write x and y separately, even though i'll always need both
i might mess up and write star_x twice, for example
maybe i can bake some safety into the code with a new allocation helper, for position

```python
def alloc_position():
    global next_free
    offset = next_free
    next_free += 2  # Position needs 2 bytes
    return offset

<!-- TODO: Replace magic numbers with named constants (POSITION_X_OFFSET=0, POSITION_Y_OFFSET=1)
     Feedback: "You rightfully complain about tag == 0 being unreadable, but the code still has offset + 1, offset + 5, offset + 9 with zero named constants." -->
def write_position(offset, x, y):
    """Write a Position to variable space"""
    memory[VAR_SPACE_OFFSET + offset + 0] = x
    memory[VAR_SPACE_OFFSET + offset + 1] = y

def read_position(offset):
    """Read a Position from variable space"""
    x = memory[VAR_SPACE_OFFSET + offset + 0]
    y = memory[VAR_SPACE_OFFSET + offset + 1]
    return (x, y)
```

now the code becomes much cleaner:

```python
star_pos = alloc_position()
star_brightness = alloc_u8()

write_position(star_pos, 240, 15)
write_u8(star_brightness, 255)
```

this is a product type! we've gone from simply expressing x, y separately to (x AND y) as a single concept called 'position'

products can actually also contain products, note that our 'star' has both a brightness and a position
let's make an allocator so making any kind of 'star' is easier

```python
def alloc_star():
    """A star is a position AND a brightness"""
    global next_free
    offset = next_free
    next_free += 3  # 2 for position, 1 for brightness 
    return offset

def write_star(offset, pos, brightness):
    # Copy the position data
    pos_x, pos_y = read_position(pos)
    write_position(offset, pos_x, pos_y)
    write_u8(offset + 2, brightness)

def read_star(offset):
    pos_x, pos_y = read_position(offset)
    brightness = read_u8(offset + 2)
    return (pos_x, pos_y), brightness

```

now let's create a full night sky:

```python
stars = []
<!-- TODO: Add missing imports: import struct, math, random from typing import Tuple
     Feedback: "Missing imports: Never shown but needed: import struct, import random, from math import pi" -->
for i in range(10):
    star = alloc_star()

    temp_pos = alloc_position()

    write_position(temp_pos,
                  random.randint(0, 255),  # any x
                  random.randint(0, 127))  # y (top half)

    write_star(star, temp_pos, random.randint(100, 250))
    stars.append(star)
```

notice how product types make it easy to do a few things. 
for one, now its hard to update y whenever we want to update x, since they're part of the same object
also, we're guaranteed to store x and y next to each other, better for the cache
our code looks cleaner too, our 'star' can take in a 'position', its easier to reason about

<!-- TODO: Add bridge paragraph explaining why we need unions after showing product type limitations
     Feedback: "The transition between products and sums feels abrupt. After building up product types organically, the sum type section starts fresh with 'I have both a Circle and a Rectangle' without explaining why the product type approach breaks down here. Adding a failed attempt to handle shapes with products would make the need for sum types clearer." -->

**motivating sum types**

i'm writing graphics code, and i have both a Circle and a Rectangle
let's continue using our memory model from before:

```
memory = bytearray(1000000)
VAR_SPACE_OFFSET = 65536
next_free = 0

def alloc_bytes(n):
    global next_free
    offset = next_free
    next_free += n
    return offset
```

i try to abstract over these, with a Shape struct

```python
class Circle:
    radius: float # 4 bytes

class Rectangle:
    width: float # 4 bytes
    height: float # 4 bytes

class Shape:
    tag: str
    radius: float
    width: float
    height: float
```

immediately this is kinda bad
we're wasting memory storing a double for width/height when we just have the Circle
nobody is stopping me from ignoring the tag and accidentally accessing width
so maybe this isn't right

let me try using our memory model conventions instead:

```python
def alloc_circle():
    return alloc_bytes(4)  # radius: 4 bytes

def alloc_rectangle():
    return alloc_bytes(8)  # width + height: 8 bytes

def write_float(offset, value):
    # serialize float to 4 bytes in memory
    struct.pack_into('<f', memory, VAR_SPACE_OFFSET + offset, value)

def read_float(offset):
    # deserialize float from memory
    return struct.unpack_from('<f', memory, VAR_SPACE_OFFSET + offset)[0]

def write_circle(offset, radius):
    write_float(offset, radius)

def read_circle(offset):
    return read_float(offset)

def write_rectangle(offset, width, height):
    write_float(offset, width)
    write_float(offset + 4, height)

def read_rectangle(offset):
    width = read_float(offset)
    height = read_float(offset + 4)
    return width, height
```

now, instead of the Shape struct having the radius/width/height all at once
we want the Shape to know which one to grab
but we might either need to allocate 4 bytes or 8 bytes, depending on if its Circle or Rectangle
the simplest way to do this is to allocate for the max anyways, and then add 1 byte at the front for if its a Circle or Rectangle

```
<!-- TODO: Fix allocation size - this breaks when adding triangle (needs 13 bytes, not 9)
     Feedback: "The 9-byte allocation for shapes (1 + max(4,8)) is mentioned but the triangle needs 13 bytes"
     Note: Triangle needs 1 (tag) + 4 + 4 + 4 = 13 bytes total -->
MAX_SIZE = max(4, 8)
shape_size = 1 + MAX_SIZE  # + 1 for the tag

def alloc_shape():
    return alloc_bytes(shape_size)
```

now, we can write

```python
def make_circle(radius: float) -> int:
    offset = alloc_shape()
    memory[VAR_SPACE_OFFSET + offset] = 0  # assign tag
    write_float(offset + 1, radius)        # radius lives at offset 1
    return offset

def make_rectangle(w: float, h: float) -> int:
    offset = alloc_shape()
    memory[VAR_SPACE_OFFSET + offset] = 1  # assign tag
    write_float(offset + 1, w)
    write_float(offset + 5, h)             # height at offset 5 (1 + 4 bytes for width)
    <!-- TODO: Replace magic numbers with named constants (TAG_OFFSET=0, RADIUS_OFFSET=1, WIDTH_OFFSET=1, HEIGHT_OFFSET=5)
         Feedback: "Magic numbers still everywhere. You rightfully complain about tag == 0 being unreadable, but the code still has offset + 1, offset + 5, offset + 9 with zero named constants." -->
    return offset
```

great, now when we make a circle or rectangle, we can appropriately write the values to our memory space
but just the offset isn't really what we wanted
we still haven't figured out how to cleanly write 'Shape' and have our code help us out
if we were to write get_area(shape) right now, it might look something like

```python
<!-- TODO: Add bounds checking and error handling for buffer access
     Feedback: "Incomplete error handling in code examples" and "set_pixel(x, y, colour) silently assumes x, y in bounds; either assert or mention the cost of defensive checks" -->
def get_area_unsafe(shape_offset):
    tag = memory[VAR_SPACE_OFFSET + shape_offset]
    if tag == 0:  # we remember that tag == 0 -> circle
        radius = read_float(shape_offset + 1)
        return 3.14159 * radius ** 2
    elif tag == 1:  # tag == 1 -> rectangle
        width = read_float(shape_offset + 1)
        height = read_float(shape_offset + 5)  # 4 bytes for width
        return width * height
```

this is better, but not really what we want
first, 'tag == 0' is kind of nonsense. its a magic number, what if we forget circle is 0? 
this code also doesn't protect us against typos
it also won't protect us against missing cases, we want the compiler/type checker to complain if we add a Triangle type to the valid list of shapes
we're also still doing manual memory management, and we're not getting any IDE support

first, we can fix the magic numbers
let's make it more explicit what shapes are allowed
what we want is a function that we can run over the types we already have 
and produce the new type that expresses 'choose circle OR rectangle' 
we'll use the set theory term 'Union' for this

```python
def make_union(*tag_info):
    valid_tags = {}
    tag_to_name = {}

    for tag_name, tag_value in tag_info:
        valid_tags[tag_name] = tag_value
        tag_to_name[tag_value] = tag_name

    def validate(offset):
        tag = memory[VAR_SPACE_OFFSET + offset]
        if tag not in tag_to_name:
            valid_tag_values = list(tag_to_name.keys())
            raise TypeError(f"Invalid tag {tag}, expected one of {valid_tag_values}")
        return offset

    return {'validate': validate, 'valid_tags': valid_tags, 'tag_to_name': tag_to_name}
```

so now we can do something like
```python
shape = make_union(
    ('circle', 0),
    ('rectangle', 1)
)
```

and

```python
<!-- TODO: Standardize parameter names - shape_offset vs offset inconsistency
     Feedback: "Inconsistent variable names" throughout the codebase -->
def get_area_shapeval(shape_offset: int, Shape) -> float:
    validated_offset = Shape['validate'](shape_offset)  # validate the offset can be a shape
    tag = memory[VAR_SPACE_OFFSET + validated_offset]
    tag_name = Shape['tag_to_name'][tag]

    if tag_name == 'circle':
        radius = read_float(shape_offset + 1)
        return 3.14159 * radius ** 2
    elif tag_name == 'rectangle':
        width = read_float(shape_offset + 1)
        height = read_float(shape_offset + 5)  # 4 bytes for width
        return width * height
```

great! now we're not dealing with magic numbers in the tags anymore!

but we're still doing some manual memory management that we'd like to abstract out a bit
let's write some helper functions that we can use to operate on these

```python
def get_circle_dims(offset: int) -> float:
    radius = read_float(offset + 1)
    return radius

def get_rectangle_dims(offset: int) -> Tuple[float, float]:
    width = read_float(offset + 1)
    height = read_float(offset + 5)  # 4 bytes for width
    return width, height
```

this is nice, but what happens now if we accidentally did something like

```python
circle = make_circle(6.0)
get_rectangle_dims(circle) # breaks!
```

we can instead make an accessor that allows us to safely access dimensions for one of our types of shapes
we'll attach this to our make_union call

```python
def make_union_with_accessors(type_name, *variants):
    """
    variants should be tuples of (tag_name, tag_value, field_accessors)
    field_accessors should be dict of {field_name: accessor_function}
    """
    type_descriptor = {
        'name': type_name,
        'variants': {},
        'tag_to_name': {},
        'field_accessors': {}
    }
    
    for tag_name, tag_value, field_accessors in variants:
        type_descriptor['variants'][tag_name] = tag_value
        type_descriptor['tag_to_name'][tag_value] = tag_name
        type_descriptor['field_accessors'][tag_name] = field_accessors
    
    def validate(offset):
        tag = memory[VAR_SPACE_OFFSET + offset]
        if tag not in type_descriptor['tag_to_name']:
            valid_tags = list(type_descriptor['tag_to_name'].keys())
            raise TypeError(f"Invalid tag {tag}, expected one of {valid_tags}")
        return offset

    def safe_access(offset, field_name):
        validated_offset = validate(offset)
        tag = memory[VAR_SPACE_OFFSET + validated_offset]
        tag_name = type_descriptor['tag_to_name'][tag]

        # Check if this field exists for this variant
        available_fields = type_descriptor['field_accessors'][tag_name]
        if field_name not in available_fields:
            valid_fields = list(available_fields.keys())
            raise TypeError(f"Field '{field_name}' not available for {tag_name}. Valid fields: {valid_fields}")

        # Use the right accessor function for this field
        accessor_func = available_fields[field_name]
        return accessor_func(validated_offset)
    
    type_descriptor['validate'] = validate
    type_descriptor['safe_access'] = safe_access
    return type_descriptor
```

and now we have

```python
<!-- TODO: Fix syntax error - should use dict {}, not list [] for field accessors
     Note: This will cause a runtime error -->
Shape = make_union_with_accessors('Shape',
    ('circle', 0, [get_circle_radius]),
    ('rectangle', 1, [get_rectangle_width, get_rectangle_height])
)
```

so now we can write

```python
Shape = make_union_with_accessors('Shape',
    ('circle', 0, {'radius': get_circle_radius}),
    ('rectangle', 1, {'width': get_rectangle_width, 'height': get_rectangle_height})
)

def get_area_safer(shape_offset, Shape):
    validated_offset = Shape['validate'](shape_offset)
    tag = memory[VAR_SPACE_OFFSET + validated_offset]
    tag_name = Shape['tag_to_name'][tag]

    if tag_name == 'circle':
        radius = Shape['safe_access'](validated_offset, 'radius')
        return 3.14159 * radius ** 2
    elif tag_name == 'rectangle':
        width = Shape['safe_access'](validated_offset, 'width')
        height = Shape['safe_access'](validated_offset, 'height')
        return width * height
```

now once we've created a shape, we can safely use our Shape union to check before dangerously accessing a memory address

```python
circle_offset = make_circle(5.0)
Shape['safe_access'](circle_offset, 'radius')  # valid
Shape['safe_access'](circle_offset, 'width')   # error: Field 'width' not available for circle
```

now, let's think about what might happen if we wanted to expand what a Shape can be
let's say we wanted to add a 'triangle' that looks like

```python
<!-- TODO: Add validation for triangle inequality and angle bounds
     Feedback: "The triangle area formula uses sin on an angle that came from random.randint(0, 127)—radians vs degrees bug waiting to happen"
     Should validate: a + b > c, a + c > b, b + c > a and 0 < gamma < π -->
def make_triangle(a: float, gamma: float, b: float) -> int:
    offset = alloc_shape()
    memory[VAR_SPACE_OFFSET + offset] = 2  # tag for triangle
    write_float(offset + 1, a)             # first side
    write_float(offset + 5, gamma)         # included angle in radians
    write_float(offset + 9, b)             # second side
    return offset

if we were to run
triangle_offset = make_triangle(3.0, pi/3, 4.0)
get_area_safer(triangle_offset) # crashes! doesn't recognize triangle
```

we need to re-run the make_union, but including the triangle

```python
Shape = make_union_with_accessors('Shape',
    ('circle', 0, {'radius': get_circle_radius}),
    ('rectangle', 1, {'width': get_rectangle_width, 'height': get_rectangle_height}),
    ('triangle', 2, {'side0': get_triangle_side0, 'incl_angle_rad': get_triangle_incl_angle_rad, 'side1': get_triangle_side1}
)
```

but now our code should fail on not having fully written the match case for get_area_safer - but our type checker doesn't know how to do this!

it would also be nice if our checker in get_area_safer automatically understood that the if cases we'd written were not exhaustive, now that the triangle exists

```python
def make_union(type_name, *variants):
    """
    Creates a sum type descriptor
    variants should be tuples of (tag_name, tag_value, field_accessors)
    field_accessors should be dict of {field_name: accessor_function}
    """
    type_descriptor = {
        'name': type_name,
        'variants': {},
        'tag_to_name': {},
        'field_accessors': {}
    }
    
    for tag_name, tag_value, field_accessors in variants:
        type_descriptor['variants'][tag_name] = tag_value
        type_descriptor['tag_to_name'][tag_value] = tag_name
        type_descriptor['field_accessors'][tag_name] = field_accessors
    
    def validate(offset):
        tag = memory[VAR_SPACE_OFFSET + offset]
        if tag not in type_descriptor['tag_to_name']:
            valid_tags = list(type_descriptor['tag_to_name'].keys())
            raise TypeError(f"Invalid tag {tag}, expected one of {valid_tags}")
        return offset

    def safe_access(offset, field_name):
        validated_offset = validate(offset)
        tag = memory[VAR_SPACE_OFFSET + validated_offset]
        tag_name = type_descriptor['tag_to_name'][tag]

        available_fields = type_descriptor['field_accessors'][tag_name]
        if field_name not in available_fields:
            valid_fields = list(available_fields.keys())
            raise TypeError(f"Field '{field_name}' not available for {tag_name}. Valid fields: {valid_fields}")

        accessor_func = available_fields[field_name]
        return accessor_func(validated_offset)

    def match(offset, **cases):
        validated_offset = validate(offset)
        tag = memory[VAR_SPACE_OFFSET + validated_offset]
        tag_name = type_descriptor['tag_to_name'][tag]
        
        # Exhaustiveness check
        if tag_name not in cases:
            provided_cases = list(cases.keys())
            all_variants = list(type_descriptor['variants'].keys())
            missing_cases = set(all_variants) - set(provided_cases)
            raise ValueError(f"Missing cases for: {missing_cases}")
        
        # Call the handler with field accessor dict
        handler = cases[tag_name]
        field_accessors = type_descriptor['field_accessors'][tag_name]
        return handler(validated_offset, field_accessors)
    
    # Create a class-like interface
    class UnionType:
        validate = staticmethod(validate)
        safe_access = staticmethod(safe_access)
        match = staticmethod(match)
        name = type_name
        variants = type_descriptor['variants']
        tag_to_name = type_descriptor['tag_to_name']
        field_accessors = type_descriptor['field_accessors']
    
    return UnionType
```

<!-- TODO: Add section discussing memory overhead, performance costs, and alternative approaches
     Feedback: "No discussion of tradeoffs or alternative approaches"
     Should cover: "This approach has tradeoffs: Pro: Type safety at runtime, exhaustiveness checking; Con: Memory overhead (wasted bytes for smaller variants), Performance cost of validation on every access; Alternative: Could use typed pointers instead of tags..." -->

this will now allow us to not only write

```python
Shape = make_union('Shape',
    ('circle', 0, {'radius': get_circle_radius}),
    ('rectangle', 1, {'width': get_rectangle_width, 'height': get_rectangle_height}),
    ('triangle', 2, {'side0': get_triangle_side0, 'incl_angle_rad': get_triangle_incl_angle_rad, 'side1': get_triangle_side1}
)
```

but will now also make it so that we can finally write the beautiful

```python
def get_area(shape_offset, Shape):
    return Shape.match(shape_offset,
        <!-- TODO: Consider performance implications of lambda closures on every match call
             Feedback: "lambda offset, fields: is clever, but the extra closure allocation on every match is measurable; at least footnote it." -->
        circle=lambda offset, fields: 3.14159 * fields['radius'](offset) ** 2,
        rectangle=lambda offset, fields: fields['width'](offset) * fields['height'](offset),
        triangle=lambda offset, fields: 0.5
            * fields["side0"](offset)
            * fields["side1"](offset)
            * math.sin(fields["incl_angle_rad"](offset)),
    )
```

as a note, here's how it looks in real-life python

```python
from typing import Union
from dataclasses import dataclass
import math

@dataclass
class Circle: radius: float
@dataclass
class Rectangle: width: float; height: float
@dataclass
class Triangle: side0: float; incl_angle_rad: float; side1: float

Shape = Union[Circle, Rectangle, Triangle]

def get_area(s: Shape) -> float:
    match s:
        case Circle(r):           return math.pi * r**2
        case Rectangle(w, h):     return w * h
        case Triangle(a, γ, b):   return 0.5 * a * b * math.sin(γ)
```

<!-- TODO: Add conclusion tying together the journey from raw bytes to type-safe pattern matching
     Feedback: "Missing conclusion tying things together" and "Current ending: ... Needs: A conclusion that ties it back to the beginning"
     Suggested conclusion: "We've built ADTs from raw bytes, discovering why we need: Product types: For data that belongs together (position = x AND y), Sum types: For data with variants (shape = circle OR rectangle OR triangle), Pattern matching: For safe, exhaustive variant handling. This journey from memory[255] = 255 to type-safe pattern matching shows..." -->

<!-- TODO: Standardize type hints usage throughout all function definitions
     Feedback: "Mix of styles in same section" - some functions have type hints, others don't -->

<!-- TODO: Compress the final "real Python" comparison
     Feedback: "You currently show the dataclass and the full match body again. Just show the signature... Tell the reader the complete gist is in the repo. ≈ 90 words saved." -->

*)

