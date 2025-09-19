---
layout: post
title: "Union Types Notes"
date: 2025-09-18
categories: [research]
tags: [ocaml, union-types, compiler-design]
slug: union-types-notes
---

<!-- TODO: Add introduction explaining what ADTs are and why they matter before diving into implementation
     Feedback: "The document really teaches 'implementing ADTs from scratch in Python' - the motivation is assumed rather than explained. A reader who doesn't already know why ADTs matter won't find that motivation here. Consider adding a brief intro explaining what problems ADTs solve at a high level before diving into implementation."
     Suggestion: "Add a 'Why Should You Care?' section - Start with a real problem that's painful without ADTs, then show how they solve it" -->

motivating union types:

i'm writing graphics code, and i have both a Circle and a Rectangle 
i try to abstract over these, with a Shape struct

class Circle:
    radius: double # 8 bytes

class Rectangle:
    width: double # 8 bytes
    height: double # 8 bytes   

class Shape:
    tag: str
    radius: float
    width: float
    height: float
   
immediately this is kinda bad
we're wasting memory storing a double for width/height when we just have the Circle
nobody is stopping me from ignoring the tag and accidentally accessing width
so maybe this isn't right

class Circle:
    radius: float # 8 bytes

class Rectangle:
    width: float # 8 bytes
    height: float # 8 bytes   

now, instead of the Shape struct having the radius/width/height all at once
we want the Shape to know which one to grab
but we might either need to allocate 8 bytes or 16 bytes, depending on if its Circle or Rectangle
the dumbest way to do this is to allocate for 16 anyways, and then add 1 byte at the front for if its a Circle or Rectangle

MAX_SIZE = max(8,16)
<!-- TODO: Fix allocation size - this breaks when adding triangle (needs 25 bytes, not 17)
     Feedback: "The 9-byte allocation for shapes (1 + max(4,8)) is mentioned but the triangle needs 13 bytes"
     Note: Triangle needs 1 (tag) + 8 + 8 + 8 = 25 bytes total -->
buffer = bytearray(1 + MAX_SIZE) # + 1 for the tag

now, we can write

def make_circle(radius: float) -> bytearray:
    buf = bytearray(buffer)          # fresh copy
    buf[0] = 0                       # assign tag
    write_float(buf, 1, radius)     # radius lives at offset 1
    return buf

def make_rectangle(w: float, h: float) -> bytearray:
    buf = bytearray(buffer)
    buf[0] = 1                       # assign tag
    write_float(buf, 1, w)
    write_float(buf, 9, h)          # second double 8 bytes later
    <!-- TODO: Replace magic numbers with named constants (RADIUS_OFFSET=1, WIDTH_OFFSET=1, HEIGHT_OFFSET=9)
         Feedback: "You rightfully complain about tag == 0 being unreadable, but the code still has offset + 1, offset + 5, offset + 9 with zero named constants. If the goal is to teach 'make illegal states unrepresentable', practise it on the byte level too." -->
    return buf

<!-- TODO: Add missing imports: import struct, math, from typing import Tuple
     Feedback: "Missing imports: Never shown but needed: import struct, import random, from math import pi" -->

def write_float(buf, offset, value):
    buf[offset:offset+8] = struct.pack('<d', value) # serialize to bytes

def read_float(buf, offset):
    return struct.unpack('<d', buf[offset:offset+8])[0] # deserialize

great, now when we make a circle or rectangle, we can appropriately write the values to our shared buffer
but just the buffer isn't really what we wanted
we still haven't figured out how to cleanly write 'Shape' and have our code help us out
if we were to write get_area(shape) right now, it might look something like

<!-- TODO: Add bounds checking and error handling for buffer access
     Feedback: "set_pixel(x, y, colour) silently assumes x, y in bounds; either assert or mention the cost of defensive checks"
     Also applies to buffer access which could go out of bounds -->

def get_area_unsafe(shape_buffer):
    tag = shape_buffer[0]
    if tag == 0:  # we remember that tag == 0 -> circle
        radius = read_float(shape_buffer, 1)
        return 3.14159 * radius ** 2
    elif tag == 1:  # tag == 1 -> rectangle
        width = read_float(shape_buffer, 1)
        height = read_float(shape_buffer, 9)
        return width * height

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

def make_union(*tag_info):
    valid_tags = {}
    tag_to_name = {}
    
    for tag_name, tag_value in tag_info:
        valid_tags[tag_name] = tag_value
        tag_to_name[tag_value] = tag_name
    
    def validate(buffer):
        tag = buffer[0]
        if tag not in tag_to_name:
            valid_tag_values = list(tag_to_name.keys())
            raise TypeError(f"Invalid tag {tag}, expected one of {valid_tag_values}")
        return buffer
    
    return {'validate': validate, 'valid_tags': valid_tags, 'tag_to_name': tag_to_name}



<!-- TODO: Add bridge paragraph explaining why we need unions after showing product type limitations
     Feedback: "The transition between products and sums feels abrupt. After building up product types organically, the sum type section starts fresh with 'I have both a Circle and a Rectangle' without explaining why the product type approach breaks down here. Adding a failed attempt to handle shapes with products would make the need for sum types clearer." -->

so now we can do something like
<!-- TODO: Fix function name - should be make_union, not make_union_basic -->
shape = make_union_basic(
    ('circle', 0),
    ('rectangle', 1)
)

and 

<!-- TODO: Standardize parameter names - shape_buffer vs buffer inconsistency
     Feedback: "Inconsistent variable names" throughout the codebase -->

def get_area_shapeval(buffer: bytearray, Shape) -> float:
    validated_buffer = Shape['validate'](shape_buffer)  # validate the buffer can be a shape
    tag = validated_buffer[0]
    tag_name = Shape['tag_to_name'][tag]

    if tag_name == 'circle':  
        radius = read_float(shape_buffer, 1)
        return 3.14159 * radius ** 2
    elif tag_name == 'rectangle':
        width = read_float(shape_buffer, 1)
        height = read_float(shape_buffer, 9)
        return width * height


great! now we're not dealing with magic numbers in the tags anymore!

but we're still doing some manual memory/buffer management that we'd like to abstract out a bit
let's write some helper functions that we can use to operate on these

def get_circle_dims(buffer: bytearray) -> float:
    radius = read_float(buffer, 1)
    return radius

def get_rectangle_dims(buffer: bytearray) -> Tuple[float, float]:
    width = read_float(buffer, 1)
    height = read_float(buffer, 9)
    return width, height

this is nice, but what happens now if we accidentally did something like

circle = make_circle(6.0)
get_rectangle_dims(circle) # breaks!

we can instead make an accessor that allows us to safely access dimensions for one of our types of shapes
we'll attach this to our make_union call

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
    
    def validate(buffer):
        tag = buffer[0]
        if tag not in type_descriptor['tag_to_name']:
            valid_tags = list(type_descriptor['tag_to_name'].keys())
            raise TypeError(f"Invalid tag {tag}, expected one of {valid_tags}")
        return buffer
    
    def safe_access(buffer, field_name):
        validated_buffer = validate(buffer)
        tag = validated_buffer[0]
        tag_name = type_descriptor['tag_to_name'][tag]
        
        # Check if this field exists for this variant
        available_fields = type_descriptor['field_accessors'][tag_name]
        if field_name not in available_fields:
            valid_fields = list(available_fields.keys())
            raise TypeError(f"Field '{field_name}' not available for {tag_name}. Valid fields: {valid_fields}")
        
        # Use the right accessor function for this field
        accessor_func = available_fields[field_name]
        return accessor_func(validated_buffer)
    
    type_descriptor['validate'] = validate
    type_descriptor['safe_access'] = safe_access
    return type_descriptor

and now we have

<!-- TODO: Fix syntax error - should use dict {}, not list [] for field accessors
     Note: This will cause a runtime error -->
Shape = make_union_with_accessors('Shape',
    ('circle', 0, [get_circle_radius]),
    ('rectangle', 1, [get_rectangle_width, get_rectangle_height])
)


so now we can write

Shape = make_union_with_accessors('Shape',
    ('circle', 0, {'radius': get_circle_radius}),
    ('rectangle', 1, {'width': get_rectangle_width, 'height': get_rectangle_height})
)

def get_area_safer(buffer, Shape):
    validated_buffer = Shape['validate'](shape_buffer)
    tag = validated_buffer[0]
    tag_name = Shape['tag_to_name'][tag]
    
    if tag_name == 'circle':
        radius = Shape['safe_access'](validated_buffer, 'radius')  
        return 3.14159 * radius ** 2
    elif tag_name == 'rectangle':
        width = Shape['safe_access'](validated_buffer, 'width')    
        height = Shape['safe_access'](validated_buffer, 'height')  
        return width * height

now once we've created a buffer, we can safely use our Shape union to check before dangerously accessing a memory address

circle_buffer = make_circle(5.0)
Shape['safe_access'](circle_buffer, 'radius')  # valid
Shape['safe_access'](circle_buffer, 'width')   # error: Field 'width' not available for circle

now, let's think about what might happen if we wanted to expand what a Shape can be
let's say we wanted to add a 'triangle' that looks like

<!-- TODO: Add validation for triangle inequality and angle bounds
     Feedback: "The triangle area formula uses sin on an angle that came from random.randint(0, 127)—radians vs degrees bug waiting to happen"
     Should validate: a + b > c, a + c > b, b + c > a and 0 < gamma < π -->

def make_triangle(a: float, gamma: float, b: float) -> bytearray:
    buf = bytearray(buffer)
    buf[0] = 2                       # tag for triangle
    write_float(buf, 1, a)          # first side
    write_float(buf, 9, gamma)      # included angle in radians 
    write_float(buf, 17, b)         # second side
    return buf

if we were to run 
triangle_buffer = make_triangle(3.0, pi/3, 4.0)
get_area_safer(triangle_buffer) # crashes! doesn't recognize triangle

we need to re-run the make_union, but including the triangle

Shape = make_union_with_accessors('Shape',
    ('circle', 0, {'radius': get_circle_radius}),
    ('rectangle', 1, {'width': get_rectangle_width, 'height': get_rectangle_height}),
    ('triangle', 2, {'side0': get_triangle_side0, 'incl_angle_rad': get_triangle_incl_angle_rad, 'side1': get_triangle_side1}
)

but now our code should fail on not having fully written the match case for get_area_safer - but our type checker doesn't know how to do this!

it would also be nice if our checker in get_area_safer automatically understood that the if cases we'd written were not exhaustive, now that the triangle exists

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
    
    def validate(buffer):
        tag = buffer[0]
        if tag not in type_descriptor['tag_to_name']:
            valid_tags = list(type_descriptor['tag_to_name'].keys())
            raise TypeError(f"Invalid tag {tag}, expected one of {valid_tags}")
        return buffer
    
    def safe_access(buffer, field_name):
        validated_buffer = validate(buffer)
        tag = validated_buffer[0]
        tag_name = type_descriptor['tag_to_name'][tag]
        
        available_fields = type_descriptor['field_accessors'][tag_name]
        if field_name not in available_fields:
            valid_fields = list(available_fields.keys())
            raise TypeError(f"Field '{field_name}' not available for {tag_name}. Valid fields: {valid_fields}")
        
        accessor_func = available_fields[field_name]
        return accessor_func(validated_buffer)
    
    def match(buffer, **cases):
        validated_buffer = validate(buffer)
        tag = validated_buffer[0]
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
        return handler(validated_buffer, field_accessors)
    
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

<!-- TODO: Add section discussing memory overhead, performance costs, and alternative approaches
     Feedback: "No discussion of tradeoffs or alternative approaches"
     Should cover: "This approach has tradeoffs: Pro: Type safety at runtime, exhaustiveness checking; Con: Memory overhead (wasted bytes for smaller variants), Performance cost of validation on every access; Alternative: Could use typed pointers instead of tags..." -->

this will now allow us to not only write 

Shape = make_union('Shape',
    ('circle', 0, {'radius': get_circle_radius}),
    ('rectangle', 1, {'width': get_rectangle_width, 'height': get_rectangle_height}),
    ('triangle', 2, {'side0': get_triangle_side0, 'incl_angle_rad': get_triangle_incl_angle_rad, 'side1': get_triangle_side1}
)

but will now also make it so that we can finally write the beautiful 

def get_area(buffer, Shape):
    return Shape.match(buffer,
        <!-- TODO: Consider performance implications of lambda closures on every match call
             Feedback: "lambda offset, fields: is clever, but the extra closure allocation on every match is measurable; at least footnote it." -->
        circle=lambda buf, fields: 3.14159 * fields['radius'](buf) ** 2,
        rectangle=lambda buf, fields: fields['width'](buf) * fields['height'](buf),
        triangle=lambda buf, fields: 0.5
            * fields["side0"](buf)
            * fields["side1"](buf)
            * math.sin(fields["incl_angle_rad"](buf)),
    )

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
