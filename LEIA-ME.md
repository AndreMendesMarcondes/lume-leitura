# Lume — leitura com foco (Chrome + VS Code)

## Instalar

**Chrome**
1. Descompacte este zip numa pasta fixa (ex.: `C:\ferramentas\lume`). O Chrome lê da pasta, então não apague depois.
2. Abra `chrome://extensions`, ligue **Modo do desenvolvedor** (canto superior direito).
3. **Carregar sem compactação** → escolha a pasta `chrome`.
4. Fixe o ícone amarelo na barra. Abas que já estavam abertas precisam de F5.

**VS Code**
1. `Ctrl+Shift+P` → **Extensions: Install from VSIX…** → escolha `lume-leitura-1.0.0.vsix`.
2. Para o *modo leitura* do editor usar Lexend/Atkinson: abra a pasta `fontes-para-instalar`, selecione os `.ttf` → botão direito → **Instalar**. Reinicie o VS Code.

## Chrome — o que tem e como usar

| Recurso | Como ligar |
|---|---|
| Bionic reading | popup ou `Alt+Shift+B` |
| Régua de leitura (faixa ou janela que escurece o resto) | popup ou `Alt+Shift+R` |
| Leitura guiada (um parágrafo por vez) | popup, `Alt+Shift+G` ou botão ¶ da barrinha. Avança com `Alt+↓`, volta com `Alt+↑` |
| Modo leitor (só o texto, sem anúncio/menu) | `Alt+Shift+L`, botão 📖 ou menu do botão direito. `Esc` fecha |
| Ler em voz alta com a palavra destacada | ▶ na barrinha, ou selecione texto → 🔊, ou botão direito → "ler a partir daqui" |
| Marca-texto e notas | selecione texto → escolha a cor (✎ = com nota). Ficam salvas e reaparecem quando você volta à página |
| Ver/exportar marcações | ✎ na barrinha (página atual) ou popup → "Todas as marcações" |
| Timer de foco | ⏱ na barrinha. Avisa no fim do bloco e conta a pausa |
| Fonte (Lexend, Atkinson, OpenDyslexic), espaçamento, filtro de cor, parar animações | popup |
| Desligar num site específico | popup → "Ativo aqui" |

A barrinha preta no canto inferior direito é o painel rápido. O ◐ minimiza.

## VS Code — o que tem e como usar

Tudo começa com `Alt+L` e depois uma letra. `Alt+L M` abre o menu com todas as opções.

| Atalho | Faz |
|---|---|
| `Alt+L B` | Bionic reading (código, comentários ou só Markdown: ajuste em Configurações → Lume) |
| `Alt+L F` | Foco: desligado → linha → parágrafo (esmaece o resto) |
| `Alt+L G` | Leitura guiada. `Alt+J` próximo parágrafo, `Alt+K` anterior |
| `Alt+L R` / `Esc` | Ler em voz alta a partir do cursor (ou da seleção) / parar |
| `Alt+L H` / `Alt+L N` | Marcar seleção / marcar com nota (a nota aparece ao passar o mouse) |
| `Alt+L T` | Timer de foco |
| `Alt+L L` | Modo leitura: fonte legível, linhas espaçadas, Zen Mode. Repita para voltar ao normal |

No preview de Markdown (`Ctrl+K V`) o bionic, a fonte, o espaçamento e a leitura guiada (`Alt+↓/↑`) também funcionam.

## Limitações conhecidas

- **Voz no Chrome:** vozes "Microsoft … Online (Natural)" informam a palavra atual. Algumas vozes do Google não informam; nelas só a frase fica destacada.
- **Voz no VS Code:** usa as vozes do Windows (ex.: Microsoft Maria). Para trocar: `Ctrl+Shift+P` → "Lume: Escolher voz".
- **Bionic em sites muito dinâmicos** (ex.: apps em React que reescrevem o texto) pode sumir ou falhar em partes. Desligue o Lume nesse site pelo popup.
- O Chrome não deixa extensões rodarem em `chrome://` nem na Chrome Web Store.
