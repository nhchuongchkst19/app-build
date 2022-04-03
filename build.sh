#!/bin/bash
git clone https://${{ secrets.GH_TOKEN }}@github.com/${{ secrets.USER }}/${{ secrets.GB_REPO }}.git
