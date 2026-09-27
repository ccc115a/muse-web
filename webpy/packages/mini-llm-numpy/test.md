
(.venv) cccuser@cccimacdeiMac mini-llm-numpy % pip3 install -e .
Obtaining file:///Users/Shared/ccc/115a/muse-web/webpy/packages/mini-llm-numpy
  Installing build dependencies ... done
  Checking if build backend supports build_editable ... done
  Getting requirements to build editable ... done
  Preparing editable metadata (pyproject.toml) ... done
Requirement already satisfied: numpy>=1.24 in /Users/cccuser/.venv/lib/python3.11/site-packages (from mini-llm-numpy==0.1.0) (2.4.5)
Building wheels for collected packages: mini-llm-numpy
  Building editable for mini-llm-numpy (pyproject.toml) ... done
  Created wheel for mini-llm-numpy: filename=mini_llm_numpy-0.1.0-0.editable-py3-none-any.whl size=2571 sha256=10ba89b500d857b58f0f2cee590df745fcc54fcdb2a030aafcf8206d37e86665
  Stored in directory: /private/var/folders/hp/1n4dfq317b1cv0dtd9w9dw040000gp/T/pip-ephem-wheel-cache-pg7_bycx/wheels/32/f1/a3/3016ad56e9ad71fb13d4b95cac7d48864e91b5a325078b17e7
Successfully built mini-llm-numpy
Installing collected packages: mini-llm-numpy
Successfully installed mini-llm-numpy-0.1.0

[notice] A new release of pip is available: 24.0 -> 26.2.1
[notice] To update, run: pip3 install --upgrade pip
(.venv) cccuser@cccimacdeiMac mini-llm-numpy % pytest           
=============================== test session starts ===============================
platform darwin -- Python 3.11.15, pytest-9.1.1, pluggy-1.6.0
rootdir: /Users/Shared/ccc/115a/muse-web/webpy/packages/mini-llm-numpy
configfile: pyproject.toml
testpaths: tests
plugins: asyncio-0.23.4, anyio-4.13.0
asyncio: mode=Mode.STRICT
collected 3 items                                                                 

tests/test_grad.py .                                                        [ 33%]
tests/test_smoke.py ..                                                      [100%]

================================ 3 passed in 0.08s ================================

