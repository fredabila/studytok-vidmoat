---
title: How the internet actually works
kind: course
topic: computer-science
level: high-school
by: StudyGraph team
language: en
license: CC-BY-4.0
tags: [networking, internet, dns, http, tcp-ip]
---

## About
You type a web address, press enter, and a page appears. In between, your request is cut into
packets, given addresses, routed through a dozen networks, reassembled and answered, all in a
fraction of a second. This short course follows that journey: what an IP address is, how names
become numbers, how packets find their way and survive loss, what HTTP and HTTPS add on top, and
what a browser does with the answer. No prior networking knowledge needed.

## Units
### Packets and addresses
The internet does not send your message in one piece. It chops it into packets of at most about
1,500 bytes, stamps each with a source and destination IP address, and sends them separately.
Packets can take different routes and arrive out of order; the receiving computer reassembles
them. An IPv4 address is four numbers from 0 to 255, such as 142.250.74.46; the newer IPv6 uses
128-bit addresses because the 4.3 billion IPv4 addresses ran out.
- IPv4 addresses are 32 bits, written as four decimal numbers separated by dots.
- IPv6 addresses are 128 bits, written as eight groups of hexadecimal digits.
- The usual maximum packet size on Ethernet, the MTU, is 1,500 bytes.

### DNS: names into numbers
Computers route by numbers, people remember names. The Domain Name System translates
study-graph.com into an IP address. Your device asks a resolver (often your ISP's or a public
one such as 1.1.1.1), which walks the hierarchy: a root server points to the servers for .com,
which point to the servers for study-graph.com, which answer with the address. Answers are cached
along the way so the second lookup is instant. DNS runs mostly over UDP on port 53.
- There are 13 root server names (A to M), served by hundreds of machines worldwide through anycast.
- A DNS record has a time to live (TTL), the number of seconds it may be cached.

### Routing: finding a path
No single map of the internet exists. Each router knows only its neighbours and which direction
leads towards blocks of addresses. The internet is a mesh of about 75,000 independent networks
(autonomous systems) run by ISPs, universities and companies, and they exchange reachability
information with the Border Gateway Protocol. A packet hops from router to router, each one
choosing the next hop, typically 10 to 20 hops to cross a continent. If a link fails, routers
learn new paths within seconds to minutes.
- BGP is the protocol that connects autonomous systems; it chooses paths by policy, not shortest distance.
- The traceroute tool shows the hops a packet takes by sending packets with increasing time-to-live values.

### TCP: making unreliable reliable
Packets get lost, duplicated and reordered. TCP sits on top of IP and fixes that: it numbers
every byte, the receiver acknowledges what arrived, and the sender retransmits anything missing.
It also starts slow and speeds up until it senses congestion, which is why a download ramps up.
A connection begins with a three-way handshake (SYN, SYN-ACK, ACK). Where speed matters more
than perfection, such as video calls, applications use UDP instead and accept some loss.
- TCP is connection-oriented and guarantees ordered, complete delivery; UDP is connectionless and does not.
- Congestion control (slow start, then additive increase) is why a single lost packet briefly halves a TCP sender's rate.

### HTTP and HTTPS
Once a connection exists, the browser speaks HTTP: a request line (GET /lesson HTTP/1.1), headers
(which site, what formats it accepts, cookies), and for the response a status code (200 OK, 404
Not Found), headers and the body. HTTPS wraps this in TLS: the server proves its identity with a
certificate signed by an authority the browser trusts, the two sides agree on keys, and from then
on nobody in the middle can read or alter the traffic. The padlock means exactly that and nothing
more: the site is who it says it is and the connection is private, not that the site is honest.
- HTTP/2 multiplexes many requests over one connection; HTTP/3 runs over QUIC, which is built on UDP.
- A TLS certificate binds a domain name to a public key and is issued by a certificate authority such as Let's Encrypt.

### What the browser does with it
The response body is usually HTML. The browser parses it into a tree (the DOM), fetches the
stylesheets, scripts, images and fonts it references (each another HTTP request), computes the
layout, paints pixels, and runs the JavaScript, which can change the page and fetch more data
without a reload. A page that feels instant is one that needs few requests, small files and no
script that blocks rendering. Developer tools in any browser show every request and how long it
took.
- The DOM (Document Object Model) is the browser's in-memory tree of the page that scripts manipulate.
- A browser caches files it has fetched so repeat visits need fewer requests.

## Facts
- The internet grew out of ARPANET, which sent its first message between UCLA and Stanford on 29 October 1969.
- TCP/IP became the ARPANET standard on 1 January 1983.
- The World Wide Web (HTML, HTTP, URLs) was proposed by Tim Berners-Lee at CERN in 1989; the first website went live in 1991.
- Light in optical fibre travels at about two-thirds of its speed in a vacuum, so a round trip across the Atlantic takes at least about 60 milliseconds.
- Most intercontinental traffic travels through undersea fibre-optic cables, not satellites.

## Quiz bank
- Q: What does DNS do? | A: Turns names into IP addresses | B: Encrypts web traffic | C: Chooses the fastest route
- Q: Which protocol guarantees packets arrive complete and in order? | A: TCP | B: UDP | C: IP
- Q: What does the padlock in the address bar mean? | A: Encrypted, identity verified | B: The site has no viruses | C: The site is honest
- Q: How does a TCP connection start? | A: A three-way handshake | B: A DNS lookup | C: A certificate exchange
- Q: Roughly how many independent networks make up the internet? | A: About 75,000 | B: About 100 | C: About 10 million
