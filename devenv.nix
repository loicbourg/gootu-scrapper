{ pkgs, lib, config, inputs, ... }:

{
  languages.javascript = {
    enable = true;
    yarn.enable = true;
  };
}
