import http.server, socketserver, functools

DIRECTORY = "/Users/jcv/Documents/compush-media.gitub.io"
PORT = 3000

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print("serving %s on :%d" % (DIRECTORY, PORT))
    httpd.serve_forever()
