### chaining error-prone steps: webscraping and monads

i'm writing a web-scraper for a data pipeline, but my code is really finicky.  
there's a ton of different potential error cases.  
for example, my code might fail at the network-request level because i'm not connected to wi-fi, and i wanna know about it.  
or my request might have the wrong parameters and fail authentication.  
i might also fail to parse a page because my html parser gets confused about some special characters.

this makes my code look really gross:

```python
import requests, json
from bs4 import BeautifulSoup

def scrape_movie_data(movie_id):
    # get the movie page
    try:
        response = requests.get(f"https://moviedb.com/movie/{movie_id}")
        if response.status_code != 200:
            return None, f"HTTP {response.status_code}"
    except requests.exceptions.ConnectionError:
        return None, "No internet connection"
    
    # parse the title
    try:
        soup = BeautifulSoup(response.text, 'html.parser') # BeautifulSoup rarely fails, but i'm trying to make a point here 
        title = soup.find('h1', class_='movie-title').text.strip()
    except:
        return None, "Failed to parse title"
    
    # get the rating page
    try:
        rating_response = requests.get(f"https://moviedb.com/movie/{movie_id}/ratings")
        if rating_response.status_code != 200:
            return None, f"Rating page HTTP error"
    except requests.exceptions.ConnectionError:
        return None, "No internet connection for ratings"
    
    # parse the rating
    try:
        rating_soup = BeautifulSoup(rating_response.text, 'html.parser')
        rating = float(rating_soup.find('span', class_='avg-rating').text)
    except:
        return None, "Failed to parse rating"
        
    return {'title': title, 'rating': rating}, None
```

this is pretty messy for what should be a relatively simple/readable data pipeline

notice the pattern i keep having to write:

1. try to do something  
2. check if it failed  
3. return an error if it did  
4. thread into the next step, or short-circuit on failure

```python
try:
    result = some_operation()
    if something_went_wrong:
        return None, "error message"
except Exception:
    return None, "different error message"
```

i don't want all these try/excepts clogging up the readability of my code.

i'd like to write something like

```python
def scrape_movie_data(movie_id: str):
    movie_url = f"https://moviedb.com/movie/{movie_id}"
    rating_url = f"https://moviedb.com/movie/{movie_id}/ratings"
    
    response = fetch_url(movie_url)
    soup = parse_html(response.text)
    ...
```

way cleaner! but there's a problem. what happens if fetch_url returns an error string?

```python
response = fetch_url("https://moviedb.com/movie/12345 ")
# response = "No internet connection"
soup = parse_html(response.text)  # fails
```

now `parse_html(response.text)` fails.

i'd like a nice way to chain these operations together, maybe something like

```python
def maybe_chain(fn, arg):
    if arg is None:  # treat None as "error"
        return None
    try:
        return fn(arg)
    except:
        return None
```

now i can write

```python
def scrape_movie_data(movie_id: str):
    movie_url = f"https://moviedb.com/movie/{movie_id}"
    
    def safe_get(url):
        try:
            response = requests.get(url)
            if response.status_code != 200:
                return None
            return response.text
        except:
            return None
    
    def safe_parse(html):
        return BeautifulSoup(html, 'html.parser')
    
    def safe_extract_title(soup):
        return soup.find('h1', class_='movie-title').text.strip()
    
    html = safe_get(movie_url)
    soup = maybe_chain(safe_parse, html)
    title = maybe_chain(safe_extract_title, soup)
    
    return title
```

but now i lose information about what actually went wrong at each step! was it a network error? a missing element in a page? with None, we can't easily find out. 

perhaps there's a better way to represent "failure" than using none. we need a way to carry both success values AND error messages through our pipeline.

here's an idea: what if we could tag a result as "success" or "fail"?
so instead of returning something like `'<html>'` we'd return `Success('<html>')`.
if we do this, we could write the function so that it automatically short-circuits and passes through on failure.

```python
from typing import Union, Callable
from dataclasses import dataclass

@dataclass
class Success:
    value: object

@dataclass
class Error:
    message: str
```

now we can return either success or error with each function:

```python
def fetch_url(url: str) -> Union[Success, Error]:
    try:
        response = requests.get(url)
        if response.status_code != 200:
            return Error(f"HTTP {response.status_code}")
        return Success(response.text)
    except requests.exceptions.ConnectionError:
        return Error("No internet connection")
    except Exception as e:
        return Error(f"Request failed: {e}")

def parse_html(html: str) -> Union[Success, Error]:
    try:
        soup = BeautifulSoup(html, 'html.parser')
        return Success(soup)
    except Exception as e:
        return Error(f"HTML parsing failed: {e}")

def extract_title(soup) -> Union[Success, Error]:
    try:
        title = soup.find('h1', class_='movie-title').text.strip()
        return Success(title)
    except Exception as e:
        return Error(f"Title extraction failed: {e}")
```

cleaner, and we can see which step failed and why.

but i still have to pepper `isinstance` through my code, and we're kind of still doing the same thing as before:

1. check if previous result was error  
2. if yes, return error  
3. else, unwrap value from error and pass to next function

what we're really trying to abstract out is something like

```python
if isinstance(result, Error):
    return result
else:
    # extract the value and do something with it
```

which can `chain` the operations like `parse_html` and `extract_title`. so we'll write a `chain` function to do it. 

this might look like 

```python
fetch_url(movie_url).chain(parse_html).chain(extract_title)
```

but then we'd have to give our `Success/Error` classes methods

what if we could write a `pipeline` function that could automatically build our chain of functions?

```python

def pipeline(initial_result: Any, *functions: List[Callable]) -> Union[Success, Error]:
    result = initial_result
    for func in functions:
        result = chain(func, result)
    return result

def scrape_movie_data(movie_id: str) -> Union[Success, Error]:
    movie_url = f"https://moviedb.com/movie/{movie_id}"
    
    return pipeline(
        fetch_url(movie_url),
        parse_html,
        extract_title
    )
```

but wait, if `chain` is the one peeling off the Success/Error wrapper, what signature should the next function actually have?

we need to decide on a convention. will our data pipeline functions all operate in terms of `Union[Success, Error]` or be agnostic to the concept?

it makes sense to let the programmer decide if a given function succeeded or failed. as a trivial example, a `divide` function knows that dividing by zero should be an `Error`. but it shouldn't have to do the manual job of unwrapping its values

so since each of our work functions take unwrapped values (like a plain string) and return wrapped `Result` values, we may as well define it as `Result = Union[Success, Error]`. you might recognize this pattern from Rust or other languages

```python
Result = Union[Success, Error]
```
and refactor our work functions accordingly

```python
def parse_html(html: str) -> Result:
    try:
        soup = BeautifulSoup(html, 'html.parser')
        return Success(soup)
    except Exception as e:
        return Error(f"HTML parsing failed: {e}")
```

now `chain` can just unwrap values, and the function will have the responsibility of defining how to wrap the result 

```python
def chain(func: Callable, wrapped_value: Result) -> Result:
     if isinstance(wrapped_value, Error):
         return wrapped_value  # short-circuit: pass error through
     else:
         # unwrap the value and apply the function
         # the function will return a new Result (Success or Error)
         return func(wrapped_value.value)
```

which allows us to write something like:

```python
def scrape_movie_data(movie_id: str) -> Result:
    movie_url = f"https://moviedb.com/movie/{movie_id}"
    
    return pipeline(
        fetch_url(movie_url),
        parse_html,
        extract_title
    )
```

let's trace through the code:

```python
# if everything works:
html_result = fetch_url("https://moviedb.com/movie/12345")
# html_result = Success("<html>...")

soup_result = chain(parse_html, html_result)
# chain() unwraps html_result.value = "<html>..."
# calls parse_html("<html>...")
# parse_html returns Success(BeautifulSoup object)
# soup_result = Success(<soup>)

title_result = chain(extract_title, soup_result)
# chain() unwraps soup_result.value = <soup>
# calls extract_title(<soup>)
# extract_title returns Success("The Matrix")
# title_result = Success("The Matrix")
```

and if there's an error:

```python
# If network fails:
html_result = fetch_url("https://moviedb.com/movie/12345")
# html_result = Error("No internet connection")

soup_result = chain(parse_html, html_result)
# chain() sees html_result is Error
# returns Error("No internet connection") without calling parse_html
# soup_result = Error("No internet connection")

title_result = chain(extract_title, soup_result)
# chain() sees soup_result is Error
# returns Error("No internet connection") without calling extract_title
# title_result = Error("No internet connection")
```

this pattern we've discovered - wrapping values in Success/Error and chaining operations that might fail - is actually a well-studied concept in functional programming. 

being able to wrap values, and chain them in a predictable way (following associativity/identity) means that our error handling will compose well no matter how we nest or combine operations. this is pattern is a monad!

what we called `chain` is traditionally called `bind`, and this Success/Error pattern is known as the Result monad (or Either monad in some languages). 
(knowing these names helps when you want to learn more or use existing libraries that implement these patterns)

let's rename our function to match that convention:

```python

def bind(func: Callable, result: Result) -> Result:
    match result: # if you have python 3.10 this is nicer than isinstance()
        case Error():
            return result
        case Success(value):
            return func(value)
```

and our scraper becomes:

```python

def scrape_movie_data(movie_id: str) -> Result:
     movie_url = f"https://moviedb.com/movie/{movie_id}"
     rating_url = f"https://moviedb.com/movie/{movie_id}/ratings"
     
     title_result = pipeline(
         fetch_url(movie_url),
         parse_html,
         extract_title
     )
     
     rating_result = pipeline(
         fetch_url(rating_url),
         parse_html,
         extract_rating
     )
     
     return (title_result, rating_result)
```

and our caller can unwrap the values as needed

```python
match scrape_movie_data("tt0133093")[0]:
    case Success(title):
        print(f"Got movie: {title}")
    case Error(msg):
        print(f"Scraping failed: {msg}")
```


we started with error-handling code drowning in repetitive try-except blocks, making it hard to read. 

but by separating the concerns of computation/core business logic (like fetch/parse/extract), and error propagation logic (check for errors and short circ)), we realized we could factor out the boilerplate of unwrapping/checking for errors with `bind` and `Result`

now our error handling happens invisibly in the background, while still propagating Errors if they occur, and our business logic stays clean

this Result pattern we've built is just one example of a monad - a general pattern for chaining operations that have some "context" (in our case, the context is "might fail").

the same bind pattern works for other contexts too:
- `List` monad: operations that might return multiple values
- `Maybe/Option` monad: operations that might return nothing (simpler than Result - no error message)
- `IO` monad: operations which might have side effects

note that you don't actually have to reimplement this in python in the way described in the blog post, that was just to illustrate the concept. the Maybe monad (might return nothing) is actually already implemented in python through Optional/None, and languages like Rust, Haskell, etc make monads first class citizens in their standard library


