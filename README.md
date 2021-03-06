# InstaKobo

Read your Instapaper articles on your Kobo device.

## What's this?

I wanted to read my Instapaper articles on my Kobo devices, and there's nothing out there that did what I wanted, so I created this to help me do that. It's tailored to my workflow:

* Generate a KEPUB for each article on my Kobo's Dropbox folder.
* Download some articles on my Kobo, optionally manually adding them to the Instapaper collection. If you use Dropbox just for Instapaper articles (like I do), you can use the Dropbox filter to see only your articles.
* Read them, add highlights.
* Sync the read progress and highlights to Instapaper (which then are synced into Readwise, and exported into Roam or Markdown).
* Read articles are archived and, optionally, deleted from your device. 

## Features

* Generate a KEPUB or EPUB for each article saved.
* Sync progress and highlights to Instapaper.
* Archive read articles and remove them from the device.

## But there's already Pocket integration on Kobo

While true, the Pocket integration lacks some important features:

* It does not support tags, which is problematic when you have hundreds of articles.
* You can't add highlights to articles.
* It has issues with some long form articles. Particularly, most of the articles from [Atavist](https://magazine.atavist.com) end up with just the first half of their content. 

## Getting started

* Make sure you have [NodeJS](https://nodejs.org/en/) installed.
* Install InstaKobo: `npm i -g instakobo`.
* Due to how the Instapaper API works, you're going to need an OAuth consumer token, which you can request [here](https://www.instapaper.com/main/request_oauth_consumer_token).
* Install [kepubify](https://pgaskin.net/kepubify/).
* TBC

## Future plans

I plan on eventually creating something similar to [Wallabako](https://gitlab.com/anarcat/wallabako), that could run directly on the device and that could also be ported to Remarkable. 
